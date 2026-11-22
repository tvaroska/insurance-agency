import { inflateSync } from "node:zlib";
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

export const DOCUMENT_TYPES = [
  "signed_application",
  "id_verification",
  "coi",
  "dec_page",
  "endorsement",
  "cancellation_notice",
  "welcome_kit",
];
export const DOCUMENT_STATUSES = ["uploaded", "pending_signature", "signed", "expired", "generated"];
export const ENVELOPE_STATUSES = ["created", "sent", "viewed", "signed", "completed", "declined", "expired"];
export const ASSET_CATEGORIES = ["welcome_kit", "flyer", "comparison_template", "social_media"];
export const SCOPES = [
  "ecm:documents:read",
  "ecm:documents:write",
  "ecm:documents:upload",
  "ecm:envelopes:read",
  "ecm:envelopes:create",
  "ecm:assets:read",
  "ecm:acord:read",
];

export const DOCUMENT_ID = /^doc_[a-z0-9]{1,8}$/;
export const ENVELOPE_ID = /^env_[a-z0-9]{1,8}$/;
export const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function todayUtc(): string {
  return "2026-10-14";
}

/** A document as the API returns it. Use `documentRow` for the database form (`tags` as JSON text). */
export function document(overrides: Record<string, unknown> = {}) {
  return {
    document_id: "DOC-1",
    client_id: "CLI-1",
    document_type: "signed_application",
    filename: "application.pdf",
    mime_type: "application/pdf",
    file_size_bytes: 1000,
    status: "signed",
    upload_date: "2024-05-01T10:00:00.000Z",
    signer_name: "Cora Client",
    signer_email: "cora@example.test",
    signed_date: "2024-05-01T11:00:00.000Z",
    expiration_date: null,
    tags: ["auto"],
    ...overrides,
  };
}

export function documentRow(overrides: Record<string, unknown> = {}) {
  const d = document(overrides);
  return { ...d, tags: JSON.stringify(d.tags) };
}

export function envelopeRow(overrides: Record<string, unknown> = {}) {
  const row: Record<string, unknown> = {
    envelope_id: "ENV-1",
    client_id: "CLI-1",
    document_ids: ["DOC-1"],
    signers: [{ name: "Cora Client", email: "cora@example.test", role: "policyholder", status: "pending", signed_at: null }],
    status: "sent",
    message: "Please sign.",
    redirect_url: null,
    created_at: "2024-05-01T10:00:00.000Z",
    completed_at: null,
    expiration_date: "2999-01-01T00:00:00.000Z",
    ...overrides,
  };
  row.document_ids = JSON.stringify(row.document_ids);
  row.signers = JSON.stringify(row.signers);
  return row;
}

export function asset(overrides: Record<string, unknown> = {}) {
  return {
    asset_id: "AST-1",
    name: "Welcome Kit",
    description: "A welcome packet.",
    category: "welcome_kit",
    mime_type: "application/pdf",
    url: "https://cdn.example.test/welcome.pdf",
    version: "1.0",
    published_date: "2024-03-01T00:00:00Z",
    ...overrides,
  };
}

// ── Peer fixtures: what the AMS and Claims stubs answer ──

export function amsClient(overrides: Record<string, unknown> = {}) {
  return {
    id: "CLI-9",
    first_name: "Cora",
    last_name: "Client",
    dob: "1980-01-01",
    email: "cora@example.test",
    phone: "+1-555-010-0009",
    address: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
    driver_license_number: "TX-123",
    occupation: "Engineer",
    marital_status: "single",
    ...overrides,
  };
}

export function amsPolicy(overrides: Record<string, unknown> = {}) {
  return {
    policy_id: "POL-9",
    client_id: "CLI-9",
    carrier_code: "ERIE",
    policy_type: "personal_auto",
    effective_date: "2026-01-01",
    expiration_date: "2027-01-01",
    premium_current: 1200,
    premium_prior: 1100,
    status: "active",
    multi_policy_discount: false,
    coverages: [
      { type: "bodily_injury", limit: "100/300", deductible: null },
      { type: "collision", limit: null, deductible: 500 },
    ],
    ...overrides,
  };
}

export function claimDetail(overrides: Record<string, unknown> = {}) {
  return {
    claim_id: "CLM-1",
    policy_id: "POL-9",
    client_id: "CLI-9",
    claim_type: "auto_collision",
    status: "reported",
    loss_date: "2026-02-01",
    reported_date: "2026-02-02",
    loss_description: "Rear-ended at a light.",
    loss_location: "Austin, TX",
    reserve_amount: 2500,
    settlement_amount: null,
    adjuster: null,
    ...overrides,
  };
}

export interface Ctx {
  svc: Service;
  /** Holds every scope an OAuth client can hold for this service. */
  api: Client;
  /** Stand-in for the AMS service (clients and policies). */
  ams: Stub;
  /** Stand-in for the Claims service. */
  claims: Stub;
}

let stubs: { ams: Stub; claims: Stub } | undefined;

export async function start(): Promise<Ctx> {
  stubs ??= { ams: startStub(), claims: startStub() };
  const svc = await startService("ecm", { env: { AMS_BASE_URL: stubs.ams.url, CLAIMS_BASE_URL: stubs.claims.url } });
  return { svc, api: await svc.client(), ...stubs };
}

/** Scripts the AMS stub: one page of clients, and each client's policies. */
export function serveAms(ams: Stub, clients: Record<string, any>[], policies: Record<string, any>[]): void {
  ams.clear(true);
  ams.on("GET", "/v1/clients", { body: { data: clients, pagination: { has_more: false, next_cursor: null } } });
  ams.on("GET", "/v1/clients/{id}", (call) => {
    const found = clients.find((c) => c.id === call.path.split("/").pop());
    return found ? { body: found } : { status: 404, body: { error_code: "NOT_FOUND", message: "client not found." } };
  });
  ams.on("GET", "/v1/clients/{id}/policies", (call) => ({
    body: { data: policies.filter((p) => p.client_id === call.path.split("/")[3]) },
  }));
}

export const ID_GAP: CheckOptions = {};

/** Validates a response against specs/ecm.yaml (with optional per-test allow list). */
export function check(contract: Contract, res: HttpResult, allow: (string | RegExp)[] = []): CheckResult {
  return allow.length > 0 ? contract.check(res, { allow }) : contract.check(res);
}

/** Validates an error response status and envelope against specs/ecm.yaml. */
export function checkError(contract: Contract, res: HttpResult): CheckResult {
  return contract.check(res);
}

/**
 * The text a PDF shows, in drawing order. Works for PDFs whose content streams
 * are plain or deflate-compressed and whose text is written as hex strings in
 * a standard single-byte font, which is what the service produces.
 */
export function pdfText(bytes: Uint8Array): string[] {
  const raw = Buffer.from(bytes);
  const out: string[] = [];
  let pos = 0;
  for (;;) {
    const marker = raw.indexOf("stream", pos);
    if (marker < 0) break;
    let start = marker + 6;
    if (raw[start] === 13) start++;
    if (raw[start] === 10) start++;
    const end = raw.indexOf("endstream", start);
    if (end < 0) break;
    pos = end + 9;
    let data: Buffer = raw.subarray(start, end);
    try {
      data = inflateSync(data);
    } catch {
      // not compressed
    }
    for (const match of data.toString("latin1").matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      // Byte 0x97 is the em dash in the PDF standard encoding.
      out.push(Buffer.from(match[1], "hex").toString("latin1").replace(/\x97/g, "—"));
    }
  }
  return out;
}

/** The text drawn right after `label`, which is where the forms put a field's value. */
export function pdfField(texts: string[], label: string, occurrence = 0): string | undefined {
  let seen = 0;
  for (let i = 0; i < texts.length; i++) {
    if (texts[i] === label && seen++ === occurrence) return texts[i + 1];
  }
  return undefined;
}

export function expectPdf(res: HttpResult): string[] {
  if (res.status !== 200) throw new Error(`expected a PDF, got ${res.status} ${res.text.slice(0, 300)}`);
  const type = res.headers.get("content-type");
  if (type !== "application/pdf") throw new Error(`expected application/pdf, got ${type}`);
  if (!res.text.startsWith("%PDF-")) throw new Error("body does not start with %PDF-");
  if (res.headers.get("content-length") !== String(res.bytes.length)) {
    throw new Error(`Content-Length ${res.headers.get("content-length")} does not match ${res.bytes.length} bytes`);
  }
  return pdfText(res.bytes);
}
