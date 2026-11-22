import { startService, type Client, type Service } from "../harness";

export const NAME = "carrier-coastal";
export const API = "/v1/coastal";
export const COOKIE_NAME = "evergreen_portal_boot_carrier-coastal";

export const SCOPES = {
  quotesRead: "carrier:quotes:read",
  quotesWrite: "carrier:quotes:write",
  underwriting: "carrier:underwriting:write",
  policiesRead: "carrier:policies:read",
} as const;

export const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
export const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface Ctx {
  svc: Service;
  /** agent-full: every carrier scope. */
  api: Client;
}

export async function start(env?: Record<string, string>): Promise<Ctx> {
  const svc = await startService(NAME, env ? { env } : {});
  return { svc, api: await svc.client() };
}

// ── The arithmetic of the specification (CST-R21 to CST-R24, CST-R32), written out independently ──

export function textHash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) & 0x7fffffff;
  return h;
}

export const riskScore = (quoteId: string) => (textHash(quoteId) % 60) + 30;
export const riskTier = (score: number) => (score >= 75 ? "preferred" : score >= 50 ? "standard" : "non_standard");
export const recommendation = (score: number) => (score >= 65 ? "approve" : score >= 45 ? "review" : "decline");

export function riskFactors(score: number) {
  return [
    {
      factor: "driver_age",
      impact: score >= 60 ? "positive" : "neutral",
      detail: score >= 60 ? "Primary driver in preferred age range" : "Driver age within acceptable range",
    },
    {
      factor: "vehicle_value",
      impact: score >= 70 ? "positive" : "neutral",
      detail: score >= 70 ? "Vehicle value within low-risk tier" : "Vehicle value is moderate",
    },
    {
      factor: "claims_history",
      impact: score >= 50 ? "positive" : "negative",
      detail: score >= 50 ? "No claims in past 3 years" : "Recent claims on file",
    },
  ];
}

const VIN_MAKES: Record<string, [string, string[]]> = {
  "1HG": ["Honda", ["Civic", "Accord", "CR-V"]],
  "1FA": ["Ford", ["Mustang", "Fusion", "F-150"]],
  "1G1": ["Chevrolet", ["Malibu", "Equinox", "Silverado"]],
  "5YJ": ["Tesla", ["Model 3", "Model Y", "Model S"]],
  WBA: ["BMW", ["3 Series", "5 Series", "X3"]],
  JTD: ["Toyota", ["Camry", "RAV4", "Corolla"]],
};

export function decodeVin(vin: string): { year: number; make: string; model: string } {
  const [make, models] = VIN_MAKES[vin.slice(0, 3).toUpperCase()] ?? ["Generic", ["Sedan"]];
  const h = textHash(vin);
  return { year: 2018 + (h % 8), make, model: models[h % models.length] };
}

export const cents = (value: number) => Math.round(value * 100) / 100;

export const DEFAULT_COVERAGES = [
  { type: "bodily_injury", limit: "100/300" },
  { type: "property_damage", limit: 50000 },
  { type: "collision", deductible: 500 },
  { type: "comprehensive", deductible: 250 },
  { type: "uninsured_motorist", limit: "100/300" },
];

// ── Rows for POST /sim/seed ──

export function quoteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quote_id: "QT-T-1",
    request_id: "QR-T-1",
    client_id: "CLI-900",
    policy_type: "personal_auto",
    premium_annual: 1000,
    premium_monthly: 83.33,
    coverages: [
      { type: "bodily_injury", limit: "100/300" },
      { type: "collision", deductible: 500 },
    ],
    deductibles: { collision: 500 },
    status: "assessed",
    valid_until: "2030-01-31",
    submitted_at: "2026-01-05T09:00:00Z",
    risk_score: 70,
    risk_tier: "standard",
    risk_factors: riskFactors(70),
    assessed_at: "2026-01-05T09:00:00Z",
    bind_status: "unbound",
    ...overrides,
  };
}

/** A quote that has not been assessed: no risk fields. */
export function rawQuoteRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return quoteRow({ status: "quoted", risk_score: null, risk_tier: null, risk_factors: null, assessed_at: null, ...overrides });
}

export function policyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    policy_id: "POL-T-1",
    client_id: "CLI-900",
    policy_type: "personal_auto",
    effective_date: "2026-01-01",
    expiration_date: "2030-01-01",
    premium_current: 1500,
    status: "active",
    coverages: [
      { type: "bodily_injury", limit: "50000/100000" },
      { type: "collision", deductible: 500 },
    ],
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/** Ids come from the clock in milliseconds, so creating calls are spaced out. */
export async function spaced<T>(call: () => Promise<T>): Promise<T> {
  await Bun.sleep(3);
  return call();
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
