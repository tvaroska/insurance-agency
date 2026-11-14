import { readFileSync } from "node:fs";
import { join } from "node:path";
import { startService, type Client, type Service, type Tables } from "../harness";

export const ALL_AMS_SCOPES = [
  "ams:clients:read",
  "ams:clients:write",
  "ams:policies:read",
  "ams:policies:write",
  "ams:policies:endorsements",
  "ams:accounting:read",
  "ams:tasks:read",
  "ams:tasks:write",
  "ams:escalations:read",
  "ams:escalations:write",
];

export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const CLIENT_ID = /^CL-[0-9a-z]{1,6}$/;
export const POLICY_ID = /^POL-[0-9a-z]{1,6}$/;
export const TASK_ID = /^TASK-[0-9a-z]{1,6}$/;
export const ESCALATION_ID = /^esc_[0-9a-z]{1,8}$/;
export const ENDORSEMENT_ID = /^END-\d{4}-\d{6}$/;

/** The fixed date the compliance firewall treats as today (AMS-R92). */
export const FIREWALL_TODAY = "2026-02-18";
export const DAY_BEFORE_FIREWALL_TODAY = "2026-02-17";

const T0 = "2025-01-01T00:00:00.000Z";

export function client(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    first_name: "Test",
    last_name: "Person",
    dob: null,
    email: `${id.toLowerCase()}@example.test`,
    phone: null,
    address_street: null,
    address_city: null,
    address_state: null,
    address_zip: null,
    driver_license_number: null,
    occupation: null,
    marital_status: null,
    household_id: null,
    preferred_contact_method: null,
    preferred_contact_time: null,
    status: "active",
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

export function policy(policy_id: string, client_id: string, overrides: Record<string, unknown> = {}) {
  return {
    policy_id,
    client_id,
    carrier_code: "SMIT",
    policy_type: "personal_auto",
    effective_date: "2025-06-01",
    expiration_date: "2026-06-01",
    premium_current: 1000,
    premium_prior: null,
    status: "active",
    multi_policy_discount: false,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

export function coverage(policy_id: string, type: string, limit: string | null, deductible: number | null = null) {
  return { policy_id, type, limit, deductible };
}

export function endorsement(endorsement_id: string, policy_id: string, overrides: Record<string, unknown> = {}) {
  return {
    endorsement_id,
    policy_id,
    effective_date: "2025-09-01",
    change_type: "add_vehicle",
    changes: JSON.stringify({ vehicle: { vin: "VIN1" } }),
    premium_delta: 120,
    status: "approved",
    notes: null,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

export function commission(commission_id: string, overrides: Record<string, unknown> = {}) {
  return {
    commission_id,
    policy_id: "POL-A-AUTO",
    carrier_code: "SMIT",
    transaction_type: "new_business",
    gross_amount: 150,
    net_amount: 105,
    commission_rate: 0.15,
    effective_date: "2025-06-01",
    payment_date: null,
    status: "pending",
    producer_id: "USR-1",
    created_at: T0,
    ...overrides,
  };
}

export function task(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `Task ${id}`,
    description: null,
    status: "open",
    priority: "medium",
    task_type: null,
    assigned_to: null,
    related_client_id: null,
    related_policy_id: null,
    due_date: "2026-03-01",
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

export function escalation(escalation_id: string, overrides: Record<string, unknown> = {}) {
  return {
    escalation_id,
    client_id: "CLI-A",
    policy_id: null,
    reason: "premium_threshold",
    summary: "Premium above the binding limit.",
    context: null,
    status: "pending",
    manager_response: null,
    poll_count: 0,
    created_at: T0,
    updated_at: T0,
    ...overrides,
  };
}

/**
 * A small book used by most tests (base `empty`):
 * - CLI-A Ann Archer (CA, household HH-1): POL-A-AUTO (auto, active), POL-A-HOME (homeowners, active)
 * - CLI-B Bob Archer (CA, household HH-1): POL-B-AUTO (auto, pending, starts 2026-03-01)
 * - CLI-C Cara Baker (TX, household HH-2, prospect): POL-C-OLD (auto, active, ended 2026-01-01),
 *   POL-C-EXP (expired), POL-C-CAN (cancelled), POL-C-NR (non_renewed)
 * - CLI-D Dan Cole (no address, no household, inactive): POL-D-AUTO (auto, active)
 */
export function book(extra: Tables = {}): Tables {
  return {
    clients: [
      client("CLI-A", {
        first_name: "Ann",
        last_name: "Archer",
        email: "ann@example.test",
        phone: "555-0100",
        address_street: "1 Main St",
        address_city: "Fresno",
        address_state: "CA",
        address_zip: "93650",
        marital_status: "married",
        household_id: "HH-1",
        preferred_contact_method: "email",
      }),
      client("CLI-B", {
        first_name: "Bob",
        last_name: "Archer",
        email: "bob@example.test",
        address_state: "CA",
        household_id: "HH-1",
      }),
      client("CLI-C", {
        first_name: "Cara",
        last_name: "Baker",
        email: "cara@example.test",
        address_state: "TX",
        household_id: "HH-2",
        status: "prospect",
      }),
      client("CLI-D", { first_name: "Dan", last_name: "Cole", email: "dan@example.test", status: "inactive" }),
    ],
    policies: [
      policy("POL-A-AUTO", "CLI-A", { multi_policy_discount: true, premium_prior: 900 }),
      policy("POL-A-HOME", "CLI-A", {
        policy_type: "homeowners",
        carrier_code: "ERIE",
        effective_date: "2025-09-01",
        expiration_date: "2026-09-01",
        premium_current: 2000,
      }),
      policy("POL-B-AUTO", "CLI-B", {
        status: "pending",
        effective_date: "2026-03-01",
        expiration_date: "2027-03-01",
        premium_current: 500,
      }),
      policy("POL-C-OLD", "CLI-C", { effective_date: "2025-01-01", expiration_date: "2026-01-01", premium_current: 700 }),
      policy("POL-C-EXP", "CLI-C", {
        policy_type: "renters",
        status: "expired",
        effective_date: "2024-01-01",
        expiration_date: "2025-01-01",
        premium_current: 300,
      }),
      policy("POL-C-CAN", "CLI-C", { status: "cancelled", effective_date: "2024-06-01", expiration_date: "2025-06-01" }),
      policy("POL-C-NR", "CLI-C", { status: "non_renewed", effective_date: "2024-07-01", expiration_date: "2025-07-01" }),
      policy("POL-D-AUTO", "CLI-D", { effective_date: "2025-10-01", expiration_date: "2026-10-01" }),
    ],
    coverages: [
      coverage("POL-A-AUTO", "bodily_injury", "100000/300000"),
      coverage("POL-A-AUTO", "property_damage", "50000"),
      coverage("POL-A-AUTO", "collision", null, 500),
      coverage("POL-A-HOME", "dwelling", "400000", 1000),
      coverage("POL-B-AUTO", "bodily_injury", "30000/60000"),
    ],
    ...extra,
  };
}

export function policyBody(overrides: Record<string, unknown> = {}) {
  return {
    client_id: "CLI-A",
    policy_type: "homeowners",
    carrier_code: "SMIT",
    effective_date: "2026-03-01",
    expiration_date: "2027-03-01",
    annual_premium: 1200,
    coverages: [{ type: "dwelling", limit: "300000", deductible: 1000 }],
    ...overrides,
  };
}

export function autoPolicyBody(coverages: unknown[], overrides: Record<string, unknown> = {}) {
  return policyBody({ policy_type: "personal_auto", coverages, ...overrides });
}

export function endorsementBody(overrides: Record<string, unknown> = {}) {
  return { effective_date: "2026-03-01", change_type: "other", changes: { note: "change" }, ...overrides };
}

export interface Ctx {
  svc: Service;
  /** Holds every scope. */
  api: Client;
}

export async function start(): Promise<Ctx> {
  // AMS-R106: without this the workbench would probe the sibling services on every governed run.
  const svc = await startService("ams", { env: { WORKBENCH_LIVE_STACK: "0" } });
  return { svc, api: await svc.client() };
}

/** Follows `next_cursor` to the end and returns every item. */
export async function readAll(api: Client, path: string, query: Record<string, string | number> = {}): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 200; page++) {
    const res = await api.get(path, { query: { ...query, cursor } });
    if (res.status !== 200) throw new Error(`GET ${path} -> ${res.status} ${res.text}`);
    items.push(...res.body.data);
    if (!res.body.pagination.has_more) return items;
    cursor = res.body.pagination.next_cursor;
  }
  throw new Error(`GET ${path} did not end after 200 pages`);
}

/** The fixed workbench content: the JSON block of Appendix A in specs/ams.spec.md. */
export function workbenchCatalogue(): any {
  const spec = readFileSync(join(import.meta.dir, "..", "..", "..", "specs", "ams.spec.md"), "utf-8");
  const appendix = spec.slice(spec.indexOf("## Appendix A: workbench catalogue"));
  const block = /```json\n([\s\S]*?)\n```/.exec(appendix);
  if (!block) throw new Error("specs/ams.spec.md has no JSON block under Appendix A");
  return JSON.parse(block[1]);
}

export function fieldCodes(res: { body: any }): string[] {
  return (res.body?.details ?? []).map((d: any) => `${d.field}:${d.code}`);
}

// ── Differences between specs/ams.yaml and the service (specs/ams.spec.md, section 14.1) ──
// Each list tolerates only the named gap; every other schema issue still fails the test.

/** Gap 3: ids are not UUIDs. Gap 7: nullable client fields, partial addresses, phone pattern. */
export const CLIENT_GAPS: (string | RegExp)[] = [
  /\/(id|household_id): .* is not a UUID/,
  /\/(dob|phone|driver_license_number|occupation|marital_status|household_id|preferred_contact_method|preferred_contact_time): is null/,
  /\/address\/(street|city|state|zip): is null/,
  /\/phone: does not match pattern/,
];

/** Gap 3: policy and client id formats. Gap 4: coverage limit is text or null. Gap 5: carrier codes, renters. */
export const POLICY_GAPS: (string | RegExp)[] = [
  /\/policy_id: does not match pattern/,
  /\/client_id: .* is not a UUID/,
  /\/carrier_code: is "(SMIT|CSTL)"/,
  /\/policy_type: is "renters"/,
  /\/coverages\/\d+\/(limit|deductible): /,
];

/** Gap 3 and gap 8: id formats, null description, extra alias fields are allowed by the schema. */
export const TASK_GAPS: (string | RegExp)[] = [
  /\/(id|assigned_to|related_client_id): .* is not a UUID/,
  /\/description: is null/,
];

/** Gap 3 and gap 5 on commission records. */
export const COMMISSION_GAPS: (string | RegExp)[] = [/\/producer_id: .* is not a UUID/, /\/carrier_code: is "(SMIT|CSTL)"/];
