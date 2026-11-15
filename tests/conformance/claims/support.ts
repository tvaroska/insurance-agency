import { startService, type Client, type Service, type Tables } from "../harness";

export const CLAIM_TYPES = [
  "auto_collision",
  "auto_comprehensive",
  "property_damage",
  "theft",
  "liability",
  "medical",
  "fire",
  "water",
  "weather",
];
export const CLAIM_STATUSES = ["reported", "assigned", "investigating", "reserved", "settled", "denied"];
export const DOCUMENT_TYPES = ["police_report", "medical_records", "photos", "estimate", "correspondence", "other"];

export const TRANSITIONS: Record<string, string[]> = {
  reported: ["assigned", "denied"],
  assigned: ["investigating", "denied"],
  investigating: ["reserved", "denied"],
  reserved: ["settled", "denied"],
  settled: [],
  denied: [],
};

export const CLAIM_ID = /^CLM-\d{4}-\d{6}$/;
export const EVENT_ID = /^EVT-[0-9a-f]{8}$/;
export const DOCUMENT_ID = /^DOC-[0-9a-f]{8}$/;
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function todayUtc(): string {
  return "2026-10-14";
}

export function adjuster(overrides: Record<string, unknown> = {}) {
  return {
    adjuster_id: "ADJ-A",
    first_name: "Ada",
    last_name: "Avery",
    email: "ada@example.test",
    phone: null,
    specialty: "auto",
    active: 1,
    max_open_claims: 25,
    created_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

export function claim(overrides: Record<string, unknown> = {}) {
  return {
    claim_id: "CLM-2024-000001",
    policy_id: "POL-1",
    client_id: "CLI-1",
    claim_type: "fire",
    status: "reported",
    loss_date: "2024-05-01",
    reported_date: "2024-05-02",
    loss_description: "Kitchen fire.",
    loss_location: null,
    reserve_amount: null,
    settlement_amount: null,
    adjuster_id: null,
    notes: null,
    created_at: "2024-05-02T10:00:00.000Z",
    updated_at: "2024-05-02T10:00:00.000Z",
    ...overrides,
  };
}

/** Three adjusters: ADJ-A (auto, active), ADJ-B (property, active), ADJ-OFF (liability, inactive). */
export function adjusters() {
  return [
    adjuster(),
    adjuster({ adjuster_id: "ADJ-B", first_name: "Ben", last_name: "Baker", email: "ben@example.test", specialty: "property" }),
    adjuster({
      adjuster_id: "ADJ-OFF",
      first_name: "Olga",
      last_name: "Offline",
      email: "olga@example.test",
      specialty: "liability",
      active: 0,
    }),
  ];
}

export function fnolBody(overrides: Record<string, unknown> = {}) {
  return {
    policy_id: "POL-9",
    client_id: "CLI-9",
    claim_type: "water",
    loss_date: "2024-06-01",
    loss_description: "Burst pipe in the basement.",
    ...overrides,
  };
}

export interface Ctx {
  svc: Service;
  /** Holds every claims scope. */
  api: Client;
}

export async function start(): Promise<Ctx> {
  const svc = await startService("claims");
  return { svc, api: await svc.client() };
}

export function seedTables(claims: Record<string, unknown>[] = [], extra: Tables = {}): Tables {
  return { adjusters: adjusters(), claims, ...extra };
}
