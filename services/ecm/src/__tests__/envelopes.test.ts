import { describe, it, expect, beforeAll } from "bun:test";
import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

// ── Mock db module with in-memory database ──
const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { envelopesRouter } from "../routes/envelopes";
import {
  createTestApp,
  createTables,
  authHeader,
  makeDocument,
} from "./setup";

const app = createTestApp({ envelopes: envelopesRouter });

const ENVELOPES_URL = "http://localhost/v1/envelopes";

// ── Request helpers ──

async function createEnvelope(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return app.request(`${ENVELOPES_URL}/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function validEnvelopeBody(overrides: Record<string, unknown> = {}) {
  return {
    client_id: "CLI-001",
    document_ids: ["doc_env_001"],
    signers: [
      { name: "Alice Smith", email: "alice@example.com", role: "policyholder" },
    ],
    ...overrides,
  };
}

// ── Seed data ──

beforeAll(() => {
  createTables(testSqlite);

  // Insert documents that envelopes can reference
  const docs = [
    makeDocument({
      document_id: "doc_env_001",
      client_id: "CLI-001",
      document_type: "signed_application",
      filename: "app.pdf",
    }),
    makeDocument({
      document_id: "doc_env_002",
      client_id: "CLI-001",
      document_type: "dec_page",
      filename: "dec.pdf",
    }),
  ];

  for (const d of docs) {
    testDb.insert(schema.documents).values(d).run();
  }
});

// ── POST /v1/envelopes/create — Auth ──

describe("POST /v1/envelopes/create - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await createEnvelope(validEnvelopeBody());
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await createEnvelope(validEnvelopeBody(), headers);
    expect(res.status).toBe(403);
  });
});

// ── POST /v1/envelopes/create — Validation ──

describe("POST /v1/envelopes/create - Validation", () => {
  it("returns 400 when client_id is missing", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const res = await createEnvelope(
      validEnvelopeBody({ client_id: undefined }),
      headers,
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when document_ids is empty", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const res = await createEnvelope(
      validEnvelopeBody({ document_ids: [] }),
      headers,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when signers is empty", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const res = await createEnvelope(
      validEnvelopeBody({ signers: [] }),
      headers,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when signer is missing required fields", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const res = await createEnvelope(
      validEnvelopeBody({
        signers: [{ name: "Alice" }], // missing email and role
      }),
      headers,
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when message exceeds max length", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const res = await createEnvelope(
      validEnvelopeBody({ message: "x".repeat(1001) }),
      headers,
    );
    expect(res.status).toBe(400);
  });

  it("returns 404 when document_ids reference non-existent documents", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const res = await createEnvelope(
      validEnvelopeBody({ document_ids: ["doc_nonexistent"] }),
      headers,
    );
    expect(res.status).toBe(404);
  });
});

// ── POST /v1/envelopes/create — Success ──

describe("POST /v1/envelopes/create - Success", () => {
  it("creates an envelope and returns 201", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const res = await createEnvelope(validEnvelopeBody(), headers);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.envelope_id).toMatch(/^env_/);
    expect(json.client_id).toBe("CLI-001");
    expect(json.document_ids).toEqual(["doc_env_001"]);
    expect(json.status).toBe("created");
    expect(json.created_at).toBeTruthy();
    expect(json.completed_at).toBeNull();
    expect(json.expiration_date).toBeTruthy();
  });

  it("sets signers with pending status", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const body = validEnvelopeBody({
      signers: [
        { name: "Alice", email: "alice@test.com", role: "policyholder" },
        { name: "Bob", email: "bob@test.com", role: "agent" },
      ],
    });
    const res = await createEnvelope(body, headers);
    const json = await res.json();

    expect(json.signers.length).toBe(2);
    for (const signer of json.signers) {
      expect(signer.status).toBe("pending");
      expect(signer.signed_at).toBeNull();
    }
  });

  it("supports multiple document_ids", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const body = validEnvelopeBody({
      document_ids: ["doc_env_001", "doc_env_002"],
    });
    const res = await createEnvelope(body, headers);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.document_ids).toEqual(["doc_env_001", "doc_env_002"]);
  });

  it("includes optional message and redirect_url", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const body = validEnvelopeBody({
      message: "Please sign this document.",
      redirect_url: "https://portal.example.com/done",
    });
    const res = await createEnvelope(body, headers);
    const json = await res.json();

    // Verify stored in DB
    const [row] = testDb
      .select()
      .from(schema.envelopes)
      .where(
        require("drizzle-orm").eq(
          schema.envelopes.envelope_id,
          json.envelope_id,
        ),
      )
      .all();
    expect(row.message).toBe("Please sign this document.");
    expect(row.redirect_url).toBe("https://portal.example.com/done");
  });

  it("sets expiration_date 30 days in the future", async () => {
    const headers = await authHeader(["ecm:envelopes:create"]);
    const res = await createEnvelope(validEnvelopeBody(), headers);
    const json = await res.json();

    const expDate = new Date(json.expiration_date);
    const now = new Date();
    const diffDays =
      (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeGreaterThan(29);
    expect(diffDays).toBeLessThan(31);
  });
});
