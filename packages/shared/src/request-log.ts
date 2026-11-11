import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

// Service-side request log (ADR-005): each service records the agent's API calls as
// OTLP client spans and exports them at GET /sim/trace, so every harness is scored
// from the same trace without instrumenting the agent.

export const INTERNAL_REQUEST_HEADER = "X-Evergreen-Internal";
export const EVAL_SCORER_HEADER = "X-Eval-Scorer";
export const SCORER_SECRET_HEADER = "X-Evergreen-Scorer-Secret";

/** Headers for service-to-service calls, which the request log must not attribute to the agent. */
export const INTERNAL_REQUEST_HEADERS = { [INTERNAL_REQUEST_HEADER]: "1" } as const;

export type HeaderSource =
  | Headers
  | Record<string, string | undefined>
  | ((name: string) => string | undefined);

function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (typeof headers === "function") {
    return headers(name) ?? headers(name.toLowerCase());
  }
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/**
 * Verifies whether a request carrying `X-Eval-Scorer: true` or `X-Evergreen-Internal: 1`
 * is authorized. When `process.env.EVERGREEN_SCORER_SECRET` is non-empty, the request must
 * also carry `X-Evergreen-Scorer-Secret === process.env.EVERGREEN_SCORER_SECRET`.
 */
export function isAuthorizedScorerOrInternal(
  headers: HeaderSource,
  kind?: "scorer" | "internal",
): boolean {
  const isScorer = readHeader(headers, EVAL_SCORER_HEADER)?.toLowerCase() === "true";
  const isInternal = readHeader(headers, INTERNAL_REQUEST_HEADER) === "1";
  const hasMarker =
    kind === "scorer"
      ? isScorer
      : kind === "internal"
        ? isInternal
        : isScorer || isInternal;
  if (!hasMarker) return false;

  const expectedSecret = process.env.EVERGREEN_SCORER_SECRET;
  if (expectedSecret && expectedSecret.length > 0) {
    return readHeader(headers, SCORER_SECRET_HEADER) === expectedSecret;
  }
  return true;
}

/**
 * Builds headers for internal service-to-service HTTP calls (`X-Evergreen-Internal: 1`,
 * plus `X-Evergreen-Scorer-Secret` when `process.env.EVERGREEN_SCORER_SECRET` is set).
 */
export function getInternalRequestHeaders(): Record<string, string> {
  const secret = process.env.EVERGREEN_SCORER_SECRET;
  if (secret && secret.length > 0) {
    return {
      [INTERNAL_REQUEST_HEADER]: "1",
      [SCORER_SECRET_HEADER]: secret,
    };
  }
  return { [INTERNAL_REQUEST_HEADER]: "1" };
}

const SCOPE_NAME = "evergreen-request-log";
const SPAN_KIND_CLIENT = 3;
const MAX_BODY_BYTES = 16 * 1024;
// Bounds memory on a long-running stack that nobody resets.
const MAX_SPANS = 10_000;

type OtlpAttribute =
  | { key: string; value: { stringValue: string } }
  | { key: string; value: { intValue: number } };

export interface RequestLogSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
}

export interface RequestLogOptions {
  serviceName: string;
  /** Canonical port for url.full and server.port, whatever port the process listens on. */
  port: number;
  /** Streamable HTTP MCP endpoint whose tools/call requests are recorded (comm only). */
  mcpPath?: string;
}

const decoder = new TextDecoder();

function unixNanoNow(): bigint {
  // Sub-millisecond precision keeps back-to-back calls to different services in order.
  return BigInt(Math.round((performance.timeOrigin + performance.now()) * 1e6));
}

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

/** Tool name of each JSON-RPC tools/call message in an MCP request body (single or batch). */
function mcpToolCalls(body: Uint8Array): (string | undefined)[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(body));
  } catch {
    return [];
  }
  const messages = Array.isArray(parsed) ? parsed : [parsed];
  const names: (string | undefined)[] = [];
  for (const message of messages as { method?: unknown; params?: { name?: unknown } }[]) {
    if (message?.method !== "tools/call") continue;
    const name = message.params?.name;
    names.push(typeof name === "string" ? name : undefined);
  }
  return names;
}

function compareStart(a: RequestLogSpan, b: RequestLogSpan): number {
  const diff = BigInt(a.startTimeUnixNano) - BigInt(b.startTimeUnixNano);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

/**
 * Creates the request-log middleware (register it on "*") and a router serving
 * GET /trace (mount it at "/sim"). A successful POST /sim/reset clears the log.
 */
export function createRequestLog(options: RequestLogOptions) {
  let spans: RequestLogSpan[] = [];

  const middleware = createMiddleware(async (c, next) => {
    const method = c.req.method;
    const path = c.req.path;

    if (method === "POST" && path === "/sim/reset") {
      await next();
      if (c.res.ok) spans = [];
      return;
    }

    const isMcp = method === "POST" && path === options.mcpPath;
    const isAuthorizedInternal =
      c.req.header(INTERNAL_REQUEST_HEADER) === "1" &&
      isAuthorizedScorerOrInternal(c.req.raw.headers, "internal");
    if ((!isMcp && !path.startsWith("/v1/")) || isAuthorizedInternal) {
      await next();
      return;
    }

    const start = unixNanoNow();
    // Read a clone so handlers (and the MCP transport) still get an unread body.
    const body = c.req.raw.body
      ? new Uint8Array(await c.req.raw.clone().arrayBuffer())
      : new Uint8Array();
    const toolNames = isMcp ? mcpToolCalls(body) : [undefined];

    await next();
    if (toolNames.length === 0) return;
    const end = unixNanoNow();

    const url = new URL(c.req.url);
    const attributes: OtlpAttribute[] = [
      { key: "http.request.method", value: { stringValue: method } },
      {
        key: "url.full",
        value: {
          stringValue: `http://localhost:${options.port}${url.pathname}${url.search}`,
        },
      },
      { key: "http.response.status_code", value: { intValue: c.res.status } },
      { key: "server.port", value: { intValue: options.port } },
      {
        key: "http.request.body",
        value: { stringValue: decoder.decode(body.subarray(0, MAX_BODY_BYTES)) },
      },
    ];

    for (const toolName of toolNames) {
      spans.push({
        traceId: randomHex(16),
        spanId: randomHex(8),
        name: `${method} ${url.pathname}`,
        kind: SPAN_KIND_CLIENT,
        startTimeUnixNano: start.toString(),
        endTimeUnixNano: end.toString(),
        attributes:
          toolName === undefined
            ? attributes
            : [...attributes, { key: "mcp.tool.name", value: { stringValue: toolName } }],
      });
    }
    if (spans.length > MAX_SPANS) spans.splice(0, spans.length - MAX_SPANS);
  });

  const router = new Hono();
  router.get("/trace", (c) =>
    c.json({
      resourceSpans: [
        {
          resource: {
            attributes: [
              { key: "service.name", value: { stringValue: options.serviceName } },
            ],
          },
          scopeSpans: [{ scope: { name: SCOPE_NAME }, spans: [...spans].sort(compareStart) }],
        },
      ],
    }),
  );

  return { middleware, router };
}
