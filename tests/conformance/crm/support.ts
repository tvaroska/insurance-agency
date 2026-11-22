import { startService, type CheckResult, type Client, type Contract, type HttpResult, type Service } from "../harness";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "proposal_sent", "closed_won", "closed_lost"];
export const LEAD_SOURCES = ["referral", "web", "cold_call", "phone", "partner", "event"];
export const CAMPAIGN_STATUSES = ["active", "paused", "completed"];
export const CAMPAIGN_TYPES = ["nurture", "retention", "cross_sell", "welcome"];
export const SCOPES = [
  "crm:leads:read",
  "crm:leads:write",
  "crm:campaigns:enroll",
  "crm:campaigns:read",
  "crm:analytics:read",
];

export const LEAD_ID = /^lead_[a-z0-9]{1,8}$/;
export const ENROLLMENT_ID = /^enr_[a-z0-9]{1,8}$/;
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function todayUtc(): string {
  return "2026-10-14";
}

/** A lead as the API returns it. Use `leadRow` for the database form. */
export function lead(overrides: Record<string, unknown> = {}) {
  return {
    lead_id: "lead_a",
    client_id: "CLI-1",
    first_name: "Lena",
    last_name: "Lead",
    email: "lena@example.test",
    phone: "+1-555-010-0001",
    source: "web",
    status: "new",
    score: 50,
    assigned_producer: "prod_1",
    tags: ["auto"],
    notes: null,
    last_activity_date: "2024-05-01",
    created_at: "2024-05-01T10:00:00.000Z",
    updated_at: "2024-05-01T10:00:00.000Z",
    ...overrides,
  };
}

/** The `leads` table stores `tags` as JSON text. */
export function leadRow(overrides: Record<string, unknown> = {}) {
  const l = lead(overrides);
  return { ...l, tags: JSON.stringify(l.tags) };
}

export function campaign(overrides: Record<string, unknown> = {}) {
  return {
    campaign_id: "camp_a",
    name: "Campaign A",
    type: "nurture",
    status: "active",
    enrolled_count: 10,
    conversion_rate: 0.25,
    ...overrides,
  };
}

export function risk(overrides: Record<string, unknown> = {}) {
  return {
    client_id: "CLI-1",
    client_name: "Client One",
    risk_score: 70,
    rate_increase_pct: 12.5,
    months_since_contact: 6,
    email_open_rate: 0.2,
    policies_count: 2,
    recommended_action: "Call the client.",
    assigned_producer: "prod_1",
    ...overrides,
  };
}

export interface Ctx {
  svc: Service;
  /** Holds every CRM scope. */
  api: Client;
}

export async function start(): Promise<Ctx> {
  const svc = await startService("crm");
  return { svc, api: await svc.client() };
}

/** Checks that an error status and envelope match specs/crm.yaml. */
export function checkError(contract: Contract, res: HttpResult): CheckResult {
  return contract.check(res);
}
