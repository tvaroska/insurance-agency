import { startService, type Client, type Service } from "../harness";

export const NAME = "carrier-summit";
export const API = "/v1/summit";
export const COOKIE_NAME = "evergreen_portal_boot_carrier-summit";

export const SCOPES = {
  quotesRead: "carrier:quotes:read",
  quotesWrite: "carrier:quotes:write",
  underwriting: "carrier:underwriting:write",
  policiesRead: "carrier:policies:read",
} as const;

export const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Known gap 3 of specs/carrier-summit.spec.md: enum values the OpenAPI file does not list. */
export const ENUM_GAPS = [
  /policy_type: is ".*", expected one of/,
  /\/status: is ".*", expected one of/,
  /document_type: is ".*", expected one of/,
  /inspection_status: is "not_scheduled"/,
];

export interface Ctx {
  svc: Service;
  /** agent-full: every carrier scope. */
  api: Client;
}

export async function start(env?: Record<string, string>): Promise<Ctx> {
  const svc = await startService(NAME, env ? { env } : {});
  return { svc, api: await svc.client() };
}

export function quoteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quote_id: "QT-T-1",
    request_id: "QR-T-1",
    client_id: "CLI-900",
    policy_type: "homeowners",
    premium_annual: 1200,
    premium_monthly: 100,
    coverages: [{ type: "dwelling", limit: 300000 }],
    deductibles: { all_perils: 1000 },
    status: "quoted",
    decline_reason: null,
    valid_until: "2030-01-31",
    submitted_at: "2026-01-05T09:00:00Z",
    underwriting_status: "pending_review",
    underwriting_notes: null,
    ...overrides,
  };
}

export function policyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policy_id: "POL-T-1",
    client_id: "CLI-900",
    policy_type: "homeowners",
    effective_date: "2026-01-01",
    expiration_date: "2030-01-01",
    premium_current: 1500,
    status: "active",
    coverages: [{ type: "dwelling", limit: "300000", deductible: 1000 }],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function documentRow(id: string, policyId: string, overrides: Record<string, unknown> = {}) {
  return {
    document_id: id,
    policy_id: policyId,
    document_type: "dec_page",
    filename: `${id.toLowerCase()}.pdf`,
    file_size_bytes: 1024,
    version: 2,
    supersedes: null,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export const SUBMISSION = {
  client_id: "CLI-001",
  policy_type: "homeowners",
  property_address: { street: "1 Aspen St", city: "Denver", state: "CO", zip: "80202" },
  property_details: { year_built: 1996, square_feet: 2400, construction_type: "frame", roof_type: "metal" },
  coverages: [{ type: "dwelling", limit: 350000 }],
};

/** POST /submissions. Ids come from the clock in milliseconds, so calls are spaced out. */
export async function submit(client: Client, body: unknown = SUBMISSION) {
  await Bun.sleep(3);
  return client.post(`${API}/submissions`, body);
}

export interface PortalSession {
  cookie: string;
  devToken: string;
  sessionToken: string;
  /** Sends what the page sends: bearer dev token plus X-Portal-Session. */
  client: Client;
}

/** The handshake the browser page performs: load `/`, fetch a dev token, fetch a portal session. */
export async function openPortal(svc: Service): Promise<PortalSession> {
  const page = await svc.http.get("/");
  const setCookie = page.headers.getSetCookie().find((c) => c.startsWith(`${COOKIE_NAME}=`));
  if (page.status !== 200 || !setCookie) throw new Error(`GET / gave ${page.status} and no bootstrap cookie`);
  const cookie = setCookie.split(";")[0];
  const dev = await svc.http.get("/auth/dev-token");
  const session = await svc.http.get("/auth/portal-session", { headers: { Cookie: cookie } });
  if (dev.status !== 200 || session.status !== 200) {
    throw new Error(`handshake failed: dev-token ${dev.status}, portal-session ${session.status} ${session.text}`);
  }
  const client = svc.withToken(dev.body.token).with({
    "Content-Type": "application/json",
    "X-Portal-Session": session.body.session_token,
  });
  return { cookie, devToken: dev.body.token, sessionToken: session.body.session_token, client };
}

export function jwtPayload(token: string): any {
  const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(part + "=".repeat((4 - (part.length % 4)) % 4)));
}
