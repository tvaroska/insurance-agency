import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { runBaselineAgent } from "../agents/baseline-agent";
import { collectTrace, mergeTraces, resolveBaseUrls, summarizeTrace } from "../collect-trace";
import { defaultBaseUrls, scorerHeaders } from "../evaluators/output";
import { evaluateTrace, parseOtlpTrace } from "../evaluators/trace";
import { generateReport } from "../report";
import { scenarios } from "../scenarios/index";
import type { ApiCall, OtlpSpan, OtlpTrace, ScopeSpan } from "../types";
import { PORT_SERVICE_MAP } from "../types";
import { createRequestLog, getInternalRequestHeaders } from "../../packages/shared/src/index";

const REPO_ROOT = join(import.meta.dir, "..", "..");

// hono is a dependency of packages/shared, not of the repo root.
const { Hono } = await import(Bun.resolveSync("hono", join(REPO_ROOT, "packages", "shared")));

function span(port: number, method: string, path: string, startNano: bigint, toolName?: string): OtlpSpan {
  return {
    traceId: "0".repeat(32),
    spanId: "0".repeat(16),
    name: `${method} ${path}`,
    kind: 3,
    startTimeUnixNano: startNano.toString(),
    endTimeUnixNano: (startNano + 100_000n).toString(),
    attributes: [
      { key: "http.request.method", value: { stringValue: method } },
      { key: "url.full", value: { stringValue: `http://localhost:${port}${path}` } },
      { key: "http.response.status_code", value: { intValue: 200 } },
      { key: "server.port", value: { intValue: port } },
      { key: "http.request.body", value: { stringValue: "" } },
      ...(toolName ? [{ key: "mcp.tool.name", value: { stringValue: toolName } }] : []),
    ],
  };
}

function serviceTrace(service: string, spans: OtlpSpan[]): OtlpTrace {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
        scopeSpans: [{ scope: { name: "evergreen-request-log" }, spans } as ScopeSpan],
      },
    ],
  };
}

// All four calls start within the same millisecond, alternating between services.
const T0 = 1_794_000_000_000_000_000n;
const amsTrace = serviceTrace("ams", [
  span(3000, "GET", "/v1/clients?last_name=Johnson", T0 + 100_000n),
  span(3000, "POST", "/v1/tasks", T0 + 700_000n),
]);
const commTrace = serviceTrace("comm", [
  span(3004, "POST", "/mcp", T0 + 300_000n, "comm_send_message"),
  span(3004, "POST", "/mcp", T0 + 500_000n, "comm_list_inbox"),
]);

describe("eval/collect-trace.ts", () => {
  test("resolveBaseUrls overrides defaultBaseUrls() from EVERGREEN_BASE_PORT and EVERGREEN_BASE_URLS", () => {
    expect(resolveBaseUrls(undefined, undefined)).toEqual(defaultBaseUrls(undefined));
    const shifted = resolveBaseUrls(undefined, "4200");
    expect(shifted.ams).toBe("http://localhost:4200");
    expect(shifted.claims).toBe("http://localhost:4207");
    const urls = resolveBaseUrls(JSON.stringify({ ams: "http://ams:3000", comm: "http://comm:3004" }), undefined);
    expect(urls.ams).toBe("http://ams:3000");
    expect(urls.comm).toBe("http://comm:3004");
    expect(urls.crm).toBe("http://localhost:3002");
    expect(Object.keys(urls)).toHaveLength(8);
    expect(() => resolveBaseUrls("not json")).toThrow("EVERGREEN_BASE_URLS");
    expect(() => resolveBaseUrls('["http://ams:3000"]')).toThrow("EVERGREEN_BASE_URLS");
    expect(() => resolveBaseUrls('{"ams": 3000}')).toThrow("EVERGREEN_BASE_URLS");
  });

  test("mergeTraces keeps sub-millisecond order across services through parseOtlpTrace", () => {
    const merged = mergeTraces([amsTrace, commTrace]);

    expect(merged.resourceSpans.map((rs) => rs.resource.attributes[0].value.stringValue)).toEqual([
      "ams",
      "comm",
      "ams",
    ]);
    expect((merged.resourceSpans[1].scopeSpans[0] as { scope?: unknown }).scope).toEqual({
      name: "evergreen-request-log",
    });

    const calls = parseOtlpTrace(merged);
    expect(calls.map((c) => [c.service, c.method, c.path])).toEqual([
      ["ams", "GET", "/v1/clients"],
      ["comm", "POST", "/v1/messages/send"],
      ["comm", "GET", "/v1/messages/inbox"],
      ["ams", "POST", "/v1/tasks"],
    ]);
    expect(calls[0].url).toBe("http://localhost:3000/v1/clients?last_name=Johnson");
    expect(summarizeTrace(merged)).toBe("ams 2, comm 2");
    expect(mergeTraces([serviceTrace("crm", [])])).toEqual({ resourceSpans: [] });
  });

  test("collectTrace fetches GET /sim/trace from every service", async () => {
    const requested: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url);
      const trace = url.startsWith("http://localhost:3000")
        ? amsTrace
        : url.startsWith("http://localhost:3004")
          ? commTrace
          : serviceTrace("other", []);
      return new Response(JSON.stringify(trace), { status: 200 });
    }) as unknown as typeof fetch;

    const trace = await collectTrace(defaultBaseUrls(), fetchImpl);
    expect(requested.sort()).toEqual(
      Object.keys(PORT_SERVICE_MAP).map((port) => `http://localhost:${port}/sim/trace`).sort(),
    );
    expect(parseOtlpTrace(trace)).toHaveLength(4);
  });

  test("collectTrace fails and names every service it could not read", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("http://localhost:3001")) throw new Error("connection refused");
      if (url.startsWith("http://localhost:3007")) return new Response("nope", { status: 404 });
      return new Response(JSON.stringify(serviceTrace("ok", [])), { status: 200 });
    }) as unknown as typeof fetch;

    const error = await collectTrace(defaultBaseUrls(), fetchImpl).then(
      () => undefined,
      (err: Error) => err,
    );
    expect(error?.message).toContain("rater: GET http://localhost:3001/sim/trace failed: connection refused");
    expect(error?.message).toContain("claims: GET http://localhost:3007/sim/trace returned 404");
  });
});

describe("service wiring for the request log", () => {
  // Importing a service's index.ts would make Bun serve its default export on the
  // shared port, so the wiring is checked in the source.
  const SERVICE_DIRS: Record<number, string> = {
    3000: "ams",
    3001: "rater",
    3002: "crm",
    3003: "ecm",
    3004: "comm",
    3005: "carrier-summit",
    3006: "carrier-coastal",
    3007: "claims",
  };

  test("every service records with the canonical port from PORT_SERVICE_MAP", () => {
    expect(Object.keys(SERVICE_DIRS)).toEqual(Object.keys(PORT_SERVICE_MAP));
    for (const [port, dir] of Object.entries(SERVICE_DIRS)) {
      const source = readFileSync(join(REPO_ROOT, "services", dir, "src", "index.ts"), "utf-8");
      const created = source.match(/createRequestLog\(\{ serviceName: "([^"]+)", port: (\d+)([^}]*)\}\)/);
      expect(created?.[1]).toBe(dir);
      expect(created?.[2]).toBe(port);
      expect(created?.[3].includes('mcpPath: "/mcp"')).toBe(dir === "comm");

      const middleware = source.indexOf('app.use("*", requestLog.middleware);');
      expect(middleware).toBeGreaterThan(source.indexOf('app.use("*", correlationId);'));
      expect(middleware).toBeLessThan(source.indexOf('app.use("*", chaosMiddleware());'));
      expect(source).toContain('app.route("/sim", requestLog.router);');
    }
  });
});

describe("service-to-service calls are marked internal via @evergreen/shared", () => {
  const prevSecret = process.env.EVERGREEN_SCORER_SECRET;
  afterEach(() => {
    if (prevSecret === undefined) delete process.env.EVERGREEN_SCORER_SECRET;
    else process.env.EVERGREEN_SCORER_SECRET = prevSecret;
  });

  test("getInternalRequestHeaders omits peer service traffic from GET /sim/trace under EVERGREEN_SCORER_SECRET", async () => {
    process.env.EVERGREEN_SCORER_SECRET = "trace-internal-secret";
    const log = createRequestLog({ serviceName: "ams", port: 3000 });
    const app = new Hono();
    app.use("*", log.middleware);
    app.route("/sim", log.router);
    app.get("/v1/clients", (c: any) => c.json({ data: [] }));

    await app.request("http://localhost:3000/v1/clients", {
      headers: { Authorization: "Bearer agent-token", ...getInternalRequestHeaders() },
    });
    await app.request("http://localhost:3000/v1/clients", {
      headers: { Authorization: "Bearer agent-token" },
    });

    const traceRes = await app.request("http://localhost:3000/sim/trace", {
      headers: scorerHeaders(),
    });
    expect(traceRes.status).toBe(200);
    const calls = parseOtlpTrace((await traceRes.json()) as OtlpTrace);
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/v1/clients");
  });
});

// The real request log in front of stand-in handlers for all 8 services, reached
// in-process through a fetch that dispatches on origin (no ports are opened).
function createStandInStack(): typeof fetch {
  const apps = new Map<string, { fetch: (req: Request) => Promise<Response> }>();
  for (const [port, service] of Object.entries(PORT_SERVICE_MAP)) {
    const log = createRequestLog({
      serviceName: service,
      port: Number(port),
      mcpPath: service === "comm" ? "/mcp" : undefined,
    });
    const app = new Hono();
    app.use("*", log.middleware);
    app.route("/sim", log.router);
    app.post("/oauth/token", (c: any) => c.json({ access_token: "test-jwt" }));
    app.get("/auth/portal-session", (c: any) => c.json({ session_token: "issued-session" }));
    app.post("/mcp", (c: any) => c.json({ jsonrpc: "2.0", id: 1, result: { content: [] } }));
    app.all("/v1/*", (c: any) => c.json({ data: [] }, c.req.method === "POST" ? 201 : 200));
    apps.set(`http://localhost:${port}`, app);
  }
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const app = apps.get(url.origin);
    if (!app) throw new Error(`no stand-in service at ${url.origin}`);
    return app.fetch(new Request(url, init));
  }) as unknown as typeof fetch;
}

function comparable(calls: ApiCall[]) {
  return calls.map(({ method, url, path, service, statusCode }) => ({ method, url, path, service, statusCode }));
}

describe("service-side traces score like the scripted agent's own trace", () => {
  test("all 20 reference playbooks yield the same calls and trace-check results", async () => {
    let commCalls = 0;
    for (const id of Object.keys(scenarios).sort()) {
      const fetchImpl = createStandInStack();
      const run = await runBaselineAgent({ scenarioId: id, fetchImpl });
      const fromServices = parseOtlpTrace(await collectTrace(defaultBaseUrls(), fetchImpl));
      const fromAgent = parseOtlpTrace(run.trace);

      expect(fromServices).toHaveLength(run.steps.length);
      expect(comparable(fromServices)).toEqual(comparable(fromAgent));
      for (const variant of Object.values(scenarios[id].variants)) {
        expect(evaluateTrace(variant.traceChecks, fromServices)).toEqual(
          evaluateTrace(variant.traceChecks, fromAgent),
        );
      }

      // MCP tools/call spans on comm are normalized to the logical REST paths.
      for (const call of fromServices.filter((c) => c.service === "comm")) {
        expect(call.url).toBe("http://localhost:3004/mcp");
        expect(["/v1/messages/send", "/v1/messages/inbox"]).toContain(call.path);
        commCalls++;
      }
    }
    expect(commCalls).toBeGreaterThan(20);
  });

  test("generateReport scores 0-call runs from real check outcomes without a call-count override", () => {
    const traceScores = evaluateTrace(scenarios["04"].variants.clean.traceChecks, []);
    expect(traceScores.every((c) => !c.passed)).toBe(true);

    const report = generateReport({
      runId: "noop-run",
      scenario: "04",
      caseId: "clean-scripted",
      seed: "clean",
      traceScores,
      outputScores: [{ name: "audit_task_created", passed: false, weight: 1.0 }],
      eoTrapResults: [],
      apiCallCount: 0,
      expectedRange: [5, 20],
    });
    expect(report.overall.eoCompliant).toBe(true);
    expect(report.overall.apiCalls).toBe(0);
    expect(report.overall.score).toBe(0);
  });
});
