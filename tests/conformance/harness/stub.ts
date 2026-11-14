// A stand-in for a peer service. Point the service under test at `stub.url`
// (for example `env: { AMS_BASE_URL: stub.url }`) to script the peer's answers
// and to assert the calls the service makes to it.

export interface StubCall {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  /** Parsed JSON when the body is JSON, the raw text otherwise, undefined when empty. */
  body: unknown;
}

export interface StubReply {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

type Responder = StubReply | ((call: StubCall) => StubReply | Promise<StubReply>);

interface Route {
  method: string;
  pattern: RegExp;
  responder: Responder;
}

export interface Stub {
  url: string;
  /** Every request received since the last `clear()`, oldest first. */
  calls: StubCall[];
  /**
   * Registers an answer. `path` is an exact path, a template such as
   * `/v1/clients/{client_id}`, or a RegExp. The newest matching route wins.
   * Unmatched requests get 404 with a NOT_FOUND error envelope.
   */
  on(method: string, path: string | RegExp, responder: Responder): Stub;
  /** Forgets recorded calls, and the routes too when `routes` is true. */
  clear(routes?: boolean): void;
  stop(): void;
}

function toPattern(path: string | RegExp): RegExp {
  if (path instanceof RegExp) return path;
  const escaped = path
    .split("/")
    .map((seg) => (seg.startsWith("{") && seg.endsWith("}") ? "[^/]+" : seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("/");
  return new RegExp(`^${escaped}$`);
}

export function startStub(): Stub {
  const routes: Route[] = [];
  const calls: StubCall[] = [];
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      const text = await req.text();
      let body: unknown = text === "" ? undefined : text;
      if (text !== "") {
        try {
          body = JSON.parse(text);
        } catch {
          // keep the raw text
        }
      }
      const call: StubCall = {
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        headers: Object.fromEntries(req.headers),
        body,
      };
      calls.push(call);
      const route = [...routes].reverse().find((r) => r.method === req.method && r.pattern.test(url.pathname));
      if (!route) {
        return Response.json({ error_code: "NOT_FOUND", message: "No stub route." }, { status: 404 });
      }
      const reply = typeof route.responder === "function" ? await route.responder(call) : route.responder;
      const status = reply.status ?? 200;
      if (reply.body === undefined) return new Response(null, { status, headers: reply.headers });
      if (typeof reply.body === "string") return new Response(reply.body, { status, headers: reply.headers });
      return Response.json(reply.body, { status, headers: reply.headers });
    },
  });
  const stub: Stub = {
    url: `http://127.0.0.1:${server.port}`,
    calls,
    on(method, path, responder) {
      routes.push({ method: method.toUpperCase(), pattern: toPattern(path), responder });
      return stub;
    },
    clear(alsoRoutes = false) {
      calls.length = 0;
      if (alsoRoutes) routes.length = 0;
    },
    stop() {
      server.stop(true);
    },
  };
  return stub;
}
