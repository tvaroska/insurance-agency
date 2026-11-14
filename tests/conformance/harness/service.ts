import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffTables, type DiffOptions, type TableDiff, type Tables } from "./diff";
import { REPO_ROOT } from "./paths";

export type ServiceName =
  | "ams"
  | "rater"
  | "crm"
  | "ecm"
  | "comm"
  | "carrier-summit"
  | "carrier-coastal"
  | "claims";

export type SeedBase = "empty" | "clean" | "realistic";

export interface HttpResult {
  status: number;
  headers: Headers;
  /** Parsed JSON when the response is JSON, otherwise the body text. */
  body: any;
  text: string;
  bytes: Uint8Array;
  request: { method: string; path: string; url: string };
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  /** Objects are sent as JSON. Strings, FormData and byte arrays are sent as they are. */
  body?: unknown;
}

export interface StartOptions {
  /** Extra environment for the service process, for example the URL of a peer stub. */
  env?: Record<string, string>;
  /**
   * Run the service's seed script (`bun run src/seed.ts`) with the same
   * environment before the service starts, and leave the database as the
   * script filled it instead of emptying it.
   */
  seedScript?: boolean;
}

/** One entry of GET /sim/trace, with the OTLP attributes flattened. */
export interface TraceSpan {
  /** `<METHOD> <path>`. */
  name: string;
  kind: number;
  method: string;
  url: string;
  status: number;
  port: number;
  body: string;
  attributes: Record<string, string | number>;
}

export interface TokenOptions {
  /** OAuth client id: `agent-full` (default), `agent-csr` or `agent-readonly`. */
  clientId?: string;
  clientSecret?: string;
  /** Scopes to request. Omit to receive every scope the client may hold. */
  scopes?: string[];
}

type Fetcher = (req: Request) => Response | Promise<Response>;

// The sandbox routes loopback traffic through its proxy unless told otherwise.
const LOOPBACK = "127.0.0.1,localhost";
for (const key of ["NO_PROXY", "no_proxy"]) {
  const current = process.env[key];
  if (!current) process.env[key] = LOOPBACK;
  else if (!current.includes("127.0.0.1")) process.env[key] = `${current},${LOOPBACK}`;
}

// Nothing listens here. A service that calls a peer the test did not provide
// fails fast instead of reaching a stack that happens to run on the default ports.
const NO_PEER = "http://127.0.0.1:9";
const PEER_URL_VARS = [
  "AMS_BASE_URL",
  "AMS_URL",
  "RATER_BASE_URL",
  "CRM_BASE_URL",
  "ECM_BASE_URL",
  "ECM_URL",
  "COMM_BASE_URL",
  "SUMMIT_BASE_URL",
  "COASTAL_BASE_URL",
  "CLAIMS_BASE_URL",
  "CLAIMS_URL",
];
const INHERITED_VARS = ["PATH", "HOME", "TMPDIR", "LANG", "TZ", "BUN_INSTALL"];

export class Client {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: Fetcher,
    private readonly defaultHeaders: Record<string, string> = {},
  ) {}

  /** A client that adds `headers` to every request. */
  with(headers: Record<string, string>): Client {
    return new Client(this.baseUrl, this.fetcher, { ...this.defaultHeaders, ...headers });
  }

  async request(method: string, path: string, opts: RequestOptions = {}): Promise<HttpResult> {
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    const headers: Record<string, string> = { ...this.defaultHeaders, ...opts.headers };
    let body: BodyInit | undefined;
    if (opts.body !== undefined) {
      if (typeof opts.body === "string" || opts.body instanceof FormData || opts.body instanceof Uint8Array) {
        body = opts.body as BodyInit;
      } else {
        body = JSON.stringify(opts.body);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === "content-type")) {
          headers["Content-Type"] = "application/json";
        }
      }
    }
    const res = await this.fetcher(new Request(url.toString(), { method, headers, body, redirect: "manual" }));
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let parsed: unknown = text;
    if ((res.headers.get("content-type") ?? "").includes("json")) {
      try {
        parsed = JSON.parse(text);
      } catch {
        // leave the text for the test to inspect
      }
    }
    return {
      status: res.status,
      headers: res.headers,
      body: parsed,
      text,
      bytes,
      request: { method: method.toUpperCase(), path: url.pathname, url: url.toString() },
    };
  }

  get(path: string, opts?: RequestOptions) {
    return this.request("GET", path, opts);
  }
  delete(path: string, opts?: RequestOptions) {
    return this.request("DELETE", path, opts);
  }
  post(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request("POST", path, { ...opts, body });
  }
  put(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request("PUT", path, { ...opts, body });
  }
  patch(path: string, body?: unknown, opts?: RequestOptions) {
    return this.request("PATCH", path, { ...opts, body });
  }
}

export class Service {
  /** Requests without credentials: /health, /oauth/token, /sim/*. */
  readonly http: Client;
  private readonly tokens = new Map<string, string>();

  constructor(
    readonly name: ServiceName,
    readonly baseUrl: string,
    /** `external`: CONFORMANCE_<SVC>_URL. `process`: child process. `in-process`: no port could be bound. */
    readonly mode: "external" | "process" | "in-process",
    private readonly fetcher: Fetcher,
    private readonly output: () => string,
    /** The temporary EVERGREEN_DATA_DIR of the service process (undefined in `external` mode). */
    readonly dataDir?: string,
  ) {
    this.http = new Client(baseUrl, fetcher);
  }

  /** What the service process wrote to stdout and stderr (empty outside `process` mode). */
  logs(): string {
    return this.output();
  }

  // ── Credentials ──

  /** Requests an access token from POST /oauth/token with the client-credentials grant. */
  async token(opts: TokenOptions = {}): Promise<string> {
    const clientId = opts.clientId ?? "agent-full";
    const key = `${clientId}|${opts.scopes?.join(" ") ?? "*"}`;
    const cached = this.tokens.get(key);
    if (cached) return cached;
    const res = await this.http.post("/oauth/token", {
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: opts.clientSecret ?? "dev-secret",
      ...(opts.scopes ? { scope: opts.scopes.join(" ") } : {}),
    });
    if (res.status !== 200 || typeof res.body?.access_token !== "string") {
      throw new Error(`POST /oauth/token for '${clientId}' failed: ${res.status} ${res.text}`);
    }
    this.tokens.set(key, res.body.access_token);
    return res.body.access_token;
  }

  /** A client that sends a bearer token obtained from the service's own token endpoint. */
  async client(opts: TokenOptions = {}): Promise<Client> {
    return this.withToken(await this.token(opts));
  }

  /** A client that sends `token` as the bearer token, valid or not. */
  withToken(token: string): Client {
    return this.http.with({ Authorization: `Bearer ${token}` });
  }

  // ── State control (HTTP only) ──

  private async sim(method: string, path: string, body?: unknown): Promise<any> {
    const res = await this.http.request(method, path, { body });
    if (res.status !== 200) throw new Error(`${method} ${path} failed: ${res.status} ${res.text}`);
    return res.body;
  }

  /**
   * POST /sim/seed. Rebuilds the database from `base` (`empty` by default) and
   * then inserts `tables` (rows keyed by table name). Also resets the
   * simulated clock and fault injection.
   */
  seed(opts: { base?: SeedBase; tables?: Tables } = {}): Promise<any> {
    return this.sim("POST", "/sim/seed", { base: opts.base ?? "empty", tables: opts.tables ?? {} });
  }

  /** POST /sim/reset. Reloads the `realistic` (default) or `clean` seed data set. */
  reset(seedMode: "clean" | "realistic" = "realistic"): Promise<any> {
    return this.sim("POST", "/sim/reset", { seed_mode: seedMode });
  }

  /** GET /sim/snapshot. Returns every table of the service, keyed by table name. */
  async snapshot(): Promise<Tables> {
    return (await this.sim("GET", "/sim/snapshot")).tables;
  }

  /** The rows of one table from GET /sim/snapshot. */
  async table(name: string): Promise<Record<string, any>[]> {
    const tables = await this.snapshot();
    if (!(name in tables)) {
      throw new Error(`Service '${this.name}' has no table '${name}'. Tables: ${Object.keys(tables).join(", ")}.`);
    }
    return tables[name];
  }

  /** Runs `action` and reports which rows it added, removed or changed. */
  async changes<T>(action: () => Promise<T>, opts?: DiffOptions): Promise<{ result: T; diff: Record<string, TableDiff> }> {
    const before = await this.snapshot();
    const result = await action();
    const after = await this.snapshot();
    return { result, diff: diffTables(before, after, opts) };
  }

  /** POST /sim/time-travel. Moves the simulated clock by `days` or to `target_date`. */
  timeTravel(opts: { days: number } | { target_date: string }): Promise<any> {
    return this.sim("POST", "/sim/time-travel", opts);
  }

  /** GET /sim/status: simulated time, clock offset, fault-injection settings. */
  status(): Promise<any> {
    return this.sim("GET", "/sim/status");
  }

  /** The simulated current time. */
  async now(): Promise<Date> {
    return new Date((await this.status()).simulated_time);
  }

  /** POST /sim/chaos. `seed` and `reset` switch fault injection off again. */
  chaos(config: { enabled: boolean; error_rate?: number; status_code?: number; latency_ms?: number }): Promise<any> {
    return this.sim("POST", "/sim/chaos", config);
  }

  /**
   * GET /sim/trace: the requests the service has logged since the last seed or
   * reset, oldest first. `raw` is the response body as sent.
   */
  async trace(): Promise<{ serviceName: string; scope: string; spans: TraceSpan[]; raw: any }> {
    const raw = await this.sim("GET", "/sim/trace");
    const resource = raw.resourceSpans?.[0] ?? {};
    const scopeSpans = resource.scopeSpans?.[0] ?? {};
    const flatten = (attributes: any[] = []) =>
      Object.fromEntries(attributes.map((a) => [a.key, a.value?.stringValue ?? a.value?.intValue]));
    const spans = (scopeSpans.spans ?? []).map((span: any) => {
      const attributes = flatten(span.attributes);
      return {
        name: span.name,
        kind: span.kind,
        method: attributes["http.request.method"],
        url: attributes["url.full"],
        status: attributes["http.response.status_code"],
        port: attributes["server.port"],
        body: attributes["http.request.body"],
        attributes,
      };
    });
    return {
      serviceName: flatten(resource.resource?.attributes)["service.name"] as string,
      scope: scopeSpans.scope?.name,
      spans,
      raw,
    };
  }

  /** Kept for symmetry with `startService`. Service processes are shared and end with the test run. */
  async stop(): Promise<void> {}
}

// ── Starting services ──

const running = new Map<string, Promise<Service>>();
const cleanups: (() => void)[] = [];
process.on("exit", () => {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      // best effort at exit
    }
  }
});

function envVarFor(name: ServiceName): string {
  return `CONFORMANCE_${name.toUpperCase().replace(/-/g, "_")}_URL`;
}

function freePort(): number | null {
  try {
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const port = probe.port;
    probe.stop(true);
    return port ?? null;
  } catch {
    return null;
  }
}

function serviceEnv(dataDir: string, extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED_VARS) {
    if (process.env[key] !== undefined) env[key] = process.env[key]!;
  }
  for (const key of PEER_URL_VARS) env[key] = NO_PEER;
  return { ...env, NO_PROXY: LOOPBACK, no_proxy: LOOPBACK, EVERGREEN_DATA_DIR: dataDir, ...extra };
}

async function waitForHealth(http: Client, exited: () => number | null, logs: () => string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let last = "";
  while (Date.now() < deadline) {
    const code = exited();
    if (code !== null) throw new Error(`service process exited with code ${code}\n${logs()}`);
    try {
      const res = await http.get("/health");
      if (res.status === 200) return;
      last = `${res.status} ${res.text}`;
    } catch (err) {
      last = String(err);
    }
    await Bun.sleep(50);
  }
  throw new Error(`service did not answer GET /health in time (${last})\n${logs()}`);
}

async function startProcess(name: ServiceName, env: Record<string, string>, dataDir: string): Promise<Service | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = freePort();
    if (port === null) return null;
    const child = Bun.spawn([process.execPath, "run", join("src", "index.ts")], {
      cwd: join(REPO_ROOT, "services", name),
      env: { ...env, PORT: String(port) },
      stdout: "pipe",
      stderr: "pipe",
    });
    let output = "";
    const collect = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) output = (output + decoder.decode(chunk)).slice(-20_000);
    };
    void collect(child.stdout).catch(() => undefined);
    void collect(child.stderr).catch(() => undefined);
    cleanups.push(() => child.kill());
    const baseUrl = `http://127.0.0.1:${port}`;
    const service = new Service(name, baseUrl, "process", (req) => fetch(req), () => output, dataDir);
    try {
      await waitForHealth(service.http, () => child.exitCode, () => output);
      return service;
    } catch (err) {
      child.kill();
      // Another process may have taken the port between the probe and the bind.
      if (attempt === 2 || !/EADDRINUSE|address already in use/i.test(output)) throw err;
    }
  }
  return null;
}

// The single place where service code is loaded into the test process. It is
// used only when the environment does not allow binding a port.
async function startInProcess(name: ServiceName, env: Record<string, string>, dataDir: string): Promise<Service> {
  Object.assign(process.env, env);
  const mod = await import(join(REPO_ROOT, "services", name, "src", "index.ts"));
  const app = mod.app ?? mod.default;
  if (typeof app?.fetch !== "function") throw new Error(`services/${name} exports no fetch handler.`);
  return new Service(name, "http://in-process.invalid", "in-process", (req) => app.fetch(req), () => "", dataDir);
}

function runSeedScript(name: ServiceName, env: Record<string, string>): void {
  const result = Bun.spawnSync([process.execPath, "run", join("src", "seed.ts")], {
    cwd: join(REPO_ROOT, "services", name),
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`seed script of '${name}' exited with code ${result.exitCode}\n${result.stdout}\n${result.stderr}`);
  }
}

/**
 * Returns a running service to test against.
 *
 * - With CONFORMANCE_<SVC>_URL set (for example CONFORMANCE_CLAIMS_URL, or
 *   CONFORMANCE_CARRIER_SUMMIT_URL), that deployment is used as it is.
 * - Otherwise the service starts as a child process on a free port with its
 *   own temporary data directory and an empty database.
 *
 * Calls with the same name and options share one process for the whole test run,
 * so each test (or `beforeEach`) must set the state it needs with `seed` or `reset`.
 */
export function startService(name: ServiceName, opts: StartOptions = {}): Promise<Service> {
  const extra = opts.env ?? {};
  const key = `${name}|${opts.seedScript ? "seeded" : ""}|${JSON.stringify(Object.entries(extra).sort())}`;
  let started = running.get(key);
  if (!started) {
    started = (async () => {
      const external = process.env[envVarFor(name)];
      if (external) {
        const service = new Service(name, external.replace(/\/+$/, ""), "external", (req) => fetch(req), () => "");
        await waitForHealth(service.http, () => null, () => "");
        return service;
      }
      const dataDir = mkdtempSync(join(tmpdir(), `conformance-${name}-`));
      cleanups.push(() => rmSync(dataDir, { recursive: true, force: true }));
      const env = serviceEnv(dataDir, extra);
      if (opts.seedScript) runSeedScript(name, env);
      const service = (await startProcess(name, env, dataDir)) ?? (await startInProcess(name, env, dataDir));
      if (!opts.seedScript) await service.seed({ base: "empty" });
      return service;
    })();
    running.set(key, started);
  }
  return started;
}
