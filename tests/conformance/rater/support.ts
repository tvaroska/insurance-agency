import {
  startService,
  startStub,
  type CheckOptions,
  type CheckResult,
  type Client,
  type Contract,
  type HttpResult,
  type Service,
  type Stub,
} from "../harness";

export const POLICY_TYPES = [
  "personal_auto",
  "homeowners",
  "umbrella",
  "bop",
  "workers_comp",
  "general_liability",
  "professional_liability",
  "renters",
];
export const PAYMENT_METHODS = ["eft", "credit_card", "check", "mortgagee_billed"];
export const SCOPES = ["rater:quotes:create", "rater:quotes:read", "rater:quotes:bind", "rater:carriers:read"];

export const REQUEST_ID = /^qr_[a-z0-9]{1,8}$/;
export const QUOTE_ID = /^qt_[a-z0-9]{1,8}$/;
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** Client names the service maps to a client id when a quote request names no id (RTR-R23). */
export const KNOWN_CLIENTS: Record<string, string> = {
  "Sarah Chen": "CLI-001",
  "James Chen": "CLI-002",
  "Maria Rodriguez": "CLI-003",
  "David Thompson": "CLI-004",
  "Linda Thompson": "CLI-005",
  "Marcus Williams": "CLI-006",
  "Priya Patel": "CLI-007",
  "Robert Kim": "CLI-008",
  "Jennifer Kim": "CLI-009",
  "Angela Foster": "CLI-010",
  "Carlos Gutierrez": "CLI-011",
  "Natasha Brooks": "CLI-012",
  "William Okafor": "CLI-013",
  "Emily Nakamura": "CLI-014",
  "George Papadopoulos": "CLI-015",
  "Ashley Morales": "CLI-016",
  "Daniel Reeves": "CLI-017",
  "Rosa Jimenez": "CLI-018",
  "Tyler Morrison": "CLI-019",
  "Samantha West": "CLI-020",
  "Brian Lawson": "CLI-021",
  "Megan Sullivan": "CLI-022",
  "Kevin Tran": "CLI-023",
  "Rachel Adams": "CLI-024",
  "Derek Hawkins": "CLI-025",
  "Victor Marsh": "CLI-026",
  "Tanya Marsh": "CLI-027",
  "Nathan Blackwood": "CLI-028",
  "Kailani Akana": "CLI-029",
  "Sara Chen": "CLI-030",
  "Patricia Kowalski": "CLI-032",
  "Andre Washington": "CLI-033",
};

/** A carrier as the API returns it. The `carriers` table stores the array fields as JSON text. */
export function carrier(overrides: Record<string, unknown> = {}) {
  return {
    carrier_code: "ERIE",
    carrier_name: "Erie Mutual",
    states: ["TX", "IL"],
    policy_types: ["personal_auto", "homeowners"],
    risk_categories: ["preferred", "standard"],
    appetite_level: "high",
    min_driver_age: 16,
    max_vehicles: 4,
    accepts_sr22: false,
    surplus_lines_only: false,
    sr22_available: false,
    citizens_eligible: false,
    state_restrictions: [],
    ...overrides,
  };
}

/** Database form of a carrier, for `svc.seed` and for comparing with `svc.table("carriers")`. */
export function carrierRow(overrides: Record<string, unknown> = {}) {
  const c = carrier(overrides) as Record<string, unknown>;
  for (const key of ["states", "policy_types", "risk_categories", "state_restrictions"]) c[key] = JSON.stringify(c[key]);
  return c;
}

export function requestRow(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    request_id: "QR-1",
    client_id: "CLI-1",
    policy_type: "homeowners",
    effective_date: "2030-06-01",
    status: "completed",
    submitted_at: "2024-05-01T10:00:00.000Z",
    completed_at: "2024-05-01T10:00:00.000Z",
    expires_at: null,
    risk_data: {},
    created_at: "2024-05-01T10:00:00.000Z",
    ...overrides,
  };
  row.risk_data = JSON.stringify(row.risk_data);
  return row;
}

export function quoteRow(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    quote_id: "QT-1",
    request_id: "QR-1",
    carrier_code: "ERIE",
    carrier_name: "Erie Mutual",
    status: "quoted",
    premium_annual: 1200,
    premium_monthly: 100,
    coverages: [],
    deductibles: {},
    decline_reason: null,
    valid_until: "2999-01-01T00:00:00.000Z",
    bound_at: null,
    created_at: "2024-05-01T10:00:00.000Z",
    ...overrides,
  };
  row.coverages = JSON.stringify(row.coverages);
  row.deductibles = JSON.stringify(row.deductibles);
  return row;
}

export function quoteRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    policy_type: "homeowners",
    effective_date: "2030-06-01",
    client: { first_name: "Quinn", last_name: "Quote", address: { state: "TX" } },
    property: { year_built: 1999 },
    requested_coverages: [{ coverage_type: "dwelling", limit: 300000 }],
    ...overrides,
  };
}

export function bindBody(overrides: Record<string, unknown> = {}) {
  return {
    payment_method: "eft",
    producer_id: "prod_1",
    insured_signature_collected: true,
    insured_signature_date: "2030-05-20",
    ...overrides,
  };
}

export interface Ctx {
  svc: Service;
  /** Holds every rater scope. */
  api: Client;
  /** Stand-in for the AMS service, which the rater asks about escalations. */
  ams: Stub;
}

let amsStub: Stub | undefined;

export async function start(): Promise<Ctx> {
  amsStub ??= startStub();
  const svc = await startService("rater", { env: { AMS_BASE_URL: amsStub.url } });
  return { svc, api: await svc.client(), ams: amsStub };
}

/** Checks that an error status and envelope match specs/rater.yaml. */
export function checkError(contract: Contract, res: HttpResult): CheckResult {
  return contract.check(res);
}

export const CARRIER_LIST_GAP: CheckOptions = {};
