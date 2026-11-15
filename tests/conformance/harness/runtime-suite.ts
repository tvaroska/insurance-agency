// Tests for the part of a service that lives outside its route handlers: the
// process and database wiring, the seed script, and the shared control plane
// (status, fault injection, request log). Every service mounts the same
// pieces, so a service's `runtime.test.ts` calls `runtimeContractTests` with
// its own rule ids and seed facts instead of repeating these tests.

import { beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startService, type Service, type ServiceName } from "./service";

export interface RuntimeContractOptions {
  service: ServiceName;
  /** The service's canonical port, which the request log reports whatever port the process listens on. */
  port: number;
  /** Rule ids of the service's spec, used in the test titles. */
  rules: {
    process: string;
    database: string;
    seeding: string;
    status: string;
    chaos: string;
    trace: string;
    /** Rule for the access log on standard output. Defaults to the `process` rule. */
    accessLog?: string;
  };
  /** The instance the service's other test files use. */
  start: () => Promise<Service>;
  /** A GET under /v1 that answers 200 on an empty database for a token with every scope. */
  readPath: string;
  /** A POST under /v1 with a JSON body. Its status does not matter; the body must show up in the request log. */
  write: { path: string; body: Record<string, unknown> };
  /**
   * Row counts after loading each data set. List every table of the service.
   * A key of the form `table[column=value]` counts the rows with that value,
   * for telling apart data sets that have the same number of rows.
   */
  seedCounts: { realistic: Record<string, number>; clean: Record<string, number> };
}

async function countRows(svc: Service, keys: string[]): Promise<Record<string, number>> {
  const tables = await svc.snapshot();
  const result: Record<string, number> = {};
  for (const key of keys) {
    const match = /^([^[]+)\[([^=]+)=(.*)\]$/.exec(key);
    if (!match) result[key] = tables[key]?.length ?? -1;
    else result[key] = (tables[match[1]] ?? []).filter((row) => String(row[match[2]]) === match[3]).length;
  }
  return result;
}

export function runtimeContractTests(opts: RuntimeContractOptions): void {
  const { service, rules } = opts;
  const keys = Object.keys(opts.seedCounts.realistic);
  const empty = Object.fromEntries(keys.map((key) => [key, 0]));
  const counts = (target: Service) => countRows(target, keys);
  let svc: Service;

  beforeAll(async () => {
    svc = await opts.start();
  }, 30_000);

  describe(`${service}: process, database and seeding`, () => {
    test(`${rules.process}, ${rules.database}: the seed script and the server share the database file under EVERGREEN_DATA_DIR`, async () => {
      const seeded = await startService(service, { env: { SEED_MODE: "clean" }, seedScript: true });
      if (seeded.mode === "external") return;
      expect(await counts(seeded)).toEqual(opts.seedCounts.clean);
      expect(existsSync(join(seeded.dataDir!, `${service}.db`))).toBe(true);
      expect((await seeded.http.get("/health")).body).toMatchObject({ status: "ok", service });
    }, 30_000);

    test(`${rules.database}: DATABASE_URL overrides the database location`, async () => {
      const dir = mkdtempSync(join(tmpdir(), `conformance-${service}-url-`));
      process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
      const file = join(dir, "custom.db");
      const custom = await startService(service, { env: { DATABASE_URL: `file:${file}` } });
      if (custom.mode === "external") return;
      await custom.reset("clean");
      expect(await counts(custom)).toEqual(opts.seedCounts.clean);
      expect(existsSync(file)).toBe(true);
      expect(existsSync(join(custom.dataDir!, `${service}.db`))).toBe(false);
    }, 30_000);

    test(`${rules.seeding}: POST /sim/reset without a body loads the data set named by SEED_MODE, realistic when unset`, async () => {
      const cleanDefault = await startService(service, { env: { SEED_MODE: "clean" }, seedScript: true });
      if (cleanDefault.mode !== "external") {
        const res = await cleanDefault.http.post("/sim/reset");
        expect(res.body).toMatchObject({ status: "reset", service, seed_mode: "clean" });
        expect(await counts(cleanDefault)).toEqual(opts.seedCounts.clean);
      }
      const res = await svc.http.post("/sim/reset");
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: "reset", service, seed_mode: "realistic" });
      expect(await counts(svc)).toEqual(opts.seedCounts.realistic);
    }, 30_000);

    test(`${rules.seeding}: seed_mode clean loads the clean data set, any other name loads the realistic one, and empty leaves the tables empty`, async () => {
      expect((await svc.reset("clean")).seed_mode).toBe("clean");
      expect(await counts(svc)).toEqual(opts.seedCounts.clean);

      const other = await svc.http.post("/sim/reset", { seed_mode: "anything-else" });
      expect(other.status).toBe(200);
      expect(await counts(svc)).toEqual(opts.seedCounts.realistic);

      const seeded = await svc.seed({ base: "empty" });
      expect(seeded).toMatchObject({ status: "seeded", service, base: "empty", inserted: {} });
      expect(await counts(svc)).toEqual(empty);
    });

    test(`${rules.seeding}: loading a data set twice gives the same rows, and POST /sim/seed rejects a bad base or table`, async () => {
      await svc.reset("realistic");
      const first = await svc.snapshot();
      await svc.reset("realistic");
      expect(await svc.snapshot()).toEqual(first);

      const badBase = await svc.http.post("/sim/seed", { base: "huge" });
      expect([badBase.status, badBase.body.error_code]).toEqual([400, "VALIDATION_ERROR"]);
      const badTable = await svc.http.post("/sim/seed", { base: "empty", tables: { no_such_table: [] } });
      expect([badTable.status, badTable.body.error_code]).toEqual([400, "VALIDATION_ERROR"]);
      expect(await svc.snapshot()).toEqual(first);
    });
  });

  describe(`${service}: control plane`, () => {
    test(`${rules.status}: GET /sim/status reports the clock, fault injection and modality mode`, async () => {
      await svc.seed();
      const status = await svc.status();
      expect(status).toEqual({
        status: "ok",
        service,
        simulated_time: expect.any(String),
        clock_offset_ms: 0,
        chaos: { enabled: false, error_rate: 0, status_code: 503, latency_ms: 0 },
        modality_mode: "permissive",
      });
      expect(status.simulated_time).toMatch(/^2026-10-14T12:00:00\.\d{3}Z$/);

      const snapshot = await svc.http.get("/sim/snapshot");
      expect(snapshot.body).toMatchObject({ service });
      expect(Object.keys(snapshot.body).sort()).toEqual(["service", "simulated_time", "tables", "timestamp"]);
    });

    test(`${rules.chaos}: with fault injection at rate 1 every /v1 request gets the configured status, other paths keep working`, async () => {
      await svc.seed();
      const api = await svc.client();
      expect((await api.get(opts.readPath)).status).toBe(200);

      const set = await svc.chaos({ enabled: true, error_rate: 1, status_code: 502 });
      expect(set).toEqual({ status: "ok", service, chaos: { enabled: true, error_rate: 1, status_code: 502, latency_ms: 0 } });
      for (const client of [api, svc.http]) {
        const { result, diff } = await svc.changes(() => client.post(opts.write.path, opts.write.body));
        expect(result.status).toBe(502);
        expect(result.body).toMatchObject({ error_code: "SERVICE_UNAVAILABLE" });
        expect(typeof result.body.correlation_id).toBe("string");
        expect(diff).toEqual({});
      }
      expect((await api.get(opts.readPath)).status).toBe(502);
      expect((await svc.http.get("/health")).status).toBe(200);
      expect((await svc.status()).chaos.enabled).toBe(true);
      const token = await svc.http.post("/oauth/token", {
        grant_type: "client_credentials",
        client_id: "agent-readonly",
        client_secret: "dev-secret",
      });
      expect(token.status).toBe(200);

      const partial = await svc.chaos({ enabled: true, error_rate: 0 });
      expect(partial.chaos).toEqual({ enabled: true, error_rate: 0, status_code: 502, latency_ms: 0 });
      expect((await api.get(opts.readPath)).status).toBe(200);
      await svc.chaos({ enabled: false, error_rate: 1 });
      expect((await api.get(opts.readPath)).status).toBe(200);
    });

    test(`${rules.chaos}: seeding and resetting switch fault injection off; enabled must be a boolean`, async () => {
      await svc.seed();
      const api = await svc.client();
      await svc.chaos({ enabled: true, error_rate: 1 });
      expect((await api.get(opts.readPath)).status).toBe(503);
      await svc.seed();
      expect((await svc.status()).chaos).toEqual({ enabled: false, error_rate: 0, status_code: 503, latency_ms: 0 });
      expect((await api.get(opts.readPath)).status).toBe(200);

      await svc.chaos({ enabled: true, error_rate: 1 });
      await svc.reset("clean");
      expect((await svc.status()).chaos.enabled).toBe(false);

      const bad = await svc.http.post("/sim/chaos", { error_rate: 1 });
      expect([bad.status, bad.body.error_code]).toEqual([400, "VALIDATION_ERROR"]);
      await svc.seed();
    });

    test(`${rules.chaos}: latency_ms delays /v1 requests`, async () => {
      await svc.seed();
      const api = await svc.client();
      await svc.chaos({ enabled: true, error_rate: 0, latency_ms: 300 });
      const started = Date.now();
      expect((await api.get(opts.readPath)).status).toBe(200);
      expect(Date.now() - started).toBeGreaterThanOrEqual(290);
      const health = Date.now();
      await svc.http.get("/health");
      expect(Date.now() - health).toBeLessThan(250);
      await svc.seed();
    });

    test(`${rules.accessLog ?? rules.process}: every answered request is written to standard output as one JSON line`, async () => {
      // Standard output is only visible when the harness started the service itself.
      if (svc.mode !== "process") return;
      await svc.seed();
      const api = await svc.client();
      const lineFor = async (id: string) => {
        for (let i = 0; i < 80; i++) {
          const line = svc
            .logs()
            .split("\n")
            .find((l) => l.includes(id));
          if (line) return JSON.parse(line);
          await Bun.sleep(25);
        }
        throw new Error(`no access-log line for ${id}\n${svc.logs().slice(-2000)}`);
      };

      const readId = `runtime-suite-${crypto.randomUUID()}`;
      const read = await api.get(opts.readPath, {
        query: { limit: 1, contact: "jane.doe@example.test" },
        headers: { "X-Correlation-ID": readId, "User-Agent": "conformance-suite" },
      });
      expect(read.status).toBe(200);
      const entry = await lineFor(readId);
      expect(Object.keys(entry).sort()).toEqual([
        "correlation_id",
        "duration_ms",
        "method",
        "path",
        "query",
        "status",
        "timestamp",
        "user_agent",
      ]);
      expect(entry).toMatchObject({
        method: "GET",
        path: opts.readPath,
        status: 200,
        correlation_id: readId,
        query: { limit: "1", contact: "j***@example.test" },
        user_agent: "conformance-suite",
      });
      expect(Math.abs(Date.parse(entry.timestamp) - Date.now())).toBeLessThan(60_000);
      expect(Number.isInteger(entry.duration_ms)).toBe(true);

      const refusedId = `runtime-suite-${crypto.randomUUID()}`;
      await svc.http.post(opts.write.path, opts.write.body, { headers: { "X-Correlation-ID": refusedId } });
      expect(await lineFor(refusedId)).toMatchObject({ method: "POST", path: opts.write.path, status: 401 });

      const healthId = `runtime-suite-${crypto.randomUUID()}`;
      await svc.http.get("/health", { headers: { "X-Correlation-ID": healthId } });
      const health = await lineFor(healthId);
      expect(health).toMatchObject({ method: "GET", path: "/health", status: 200 });
      expect("query" in health).toBe(false);
    });

    test(`${rules.trace}: GET /sim/trace lists every /v1 request since the last seed or reset`, async () => {
      await svc.seed();
      const api = await svc.client();
      expect((await svc.trace()).spans).toEqual([]);

      await api.get(opts.readPath, { query: { limit: 1 } });
      await api.post(opts.write.path, opts.write.body);
      await svc.http.get(opts.readPath);
      await svc.http.get("/health");
      await svc.status();
      await api.get(opts.readPath, { headers: { "X-Evergreen-Internal": "1" } });

      const trace = await svc.trace();
      expect(trace.serviceName).toBe(service);
      expect(trace.scope).toBe("evergreen-request-log");
      expect(trace.spans.map((s) => [s.name, s.method, s.status === 401])).toEqual([
        [`GET ${opts.readPath}`, "GET", false],
        [`POST ${opts.write.path}`, "POST", false],
        [`GET ${opts.readPath}`, "GET", true],
      ]);
      const [read, write] = trace.spans;
      expect(read).toMatchObject({
        kind: 3,
        url: `http://localhost:${opts.port}${opts.readPath}?limit=1`,
        status: 200,
        port: opts.port,
        body: "",
      });
      expect(write.url).toBe(`http://localhost:${opts.port}${opts.write.path}`);
      expect(JSON.parse(write.body)).toEqual(opts.write.body);
      for (const span of trace.raw.resourceSpans[0].scopeSpans[0].spans) {
        expect(span.traceId).toMatch(/^[0-9a-f]{32}$/);
        expect(span.spanId).toMatch(/^[0-9a-f]{16}$/);
        expect(BigInt(span.endTimeUnixNano) >= BigInt(span.startTimeUnixNano)).toBe(true);
      }

      await svc.reset("clean");
      expect((await svc.trace()).spans).toEqual([]);
      await svc.seed();
    });
  });
}
