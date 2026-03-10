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

import { documentsRouter } from "../routes/documents";
import { createTestApp, createTables, authHeader, makeDocument } from "./setup";

const app = createTestApp({ documents: documentsRouter });

const DOCS_URL = "http://localhost/v1/documents";

// ── Request helpers ──

async function uploadDocument(
  formData: FormData,
  headers: Record<string, string> = {},
) {
  return app.request(`${DOCS_URL}/upload`, {
    method: "POST",
    headers,
    body: formData,
  });
}

async function getAudit(
  clientId: string,
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const url = new URL(`${DOCS_URL}/${clientId}/audit`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

async function listDocuments(
  params: Record<string, string> = {},
  headers: Record<string, string> = {},
) {
  const url = new URL(DOCS_URL);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

function makeFormData(overrides: Record<string, string | Blob> = {}) {
  const fd = new FormData();
  if (!("file" in overrides)) {
    fd.set("file", new File(["test content"], "test.pdf", { type: "application/pdf" }));
  }
  if (!("client_id" in overrides)) fd.set("client_id", "CLI-001");
  if (!("document_type" in overrides)) fd.set("document_type", "signed_application");

  for (const [k, v] of Object.entries(overrides)) {
    if (v === null) {
      fd.delete(k);
    } else {
      fd.set(k, v);
    }
  }
  return fd;
}

// ── Seed data ──

beforeAll(() => {
  createTables(testSqlite);

  const docs = [
    makeDocument({
      document_id: "doc_001",
      client_id: "CLI-001",
      document_type: "signed_application",
      filename: "application.pdf",
      upload_date: "2026-02-15T10:00:00Z",
      tags: JSON.stringify(["auto"]),
    }),
    makeDocument({
      document_id: "doc_002",
      client_id: "CLI-001",
      document_type: "id_verification",
      filename: "drivers_license.jpg",
      mime_type: "image/jpeg",
      upload_date: "2026-02-14T10:00:00Z",
    }),
    makeDocument({
      document_id: "doc_003",
      client_id: "CLI-001",
      document_type: "dec_page",
      filename: "dec_page.pdf",
      upload_date: "2026-02-13T10:00:00Z",
      status: "expired",
      expiration_date: "2025-01-01T00:00:00Z", // expired
    }),
    makeDocument({
      document_id: "doc_004",
      client_id: "CLI-002",
      document_type: "coi",
      filename: "coi.pdf",
      status: "generated",
      upload_date: "2026-02-10T10:00:00Z",
    }),
    // CLI-003 has no signed_application → missing_documents
    makeDocument({
      document_id: "doc_005",
      client_id: "CLI-003",
      document_type: "id_verification",
      filename: "id.jpg",
      mime_type: "image/jpeg",
      upload_date: "2026-02-12T10:00:00Z",
    }),
    makeDocument({
      document_id: "doc_006",
      client_id: "CLI-001",
      document_type: "endorsement",
      filename: "endorsement.pdf",
      status: "pending_signature",
      upload_date: "2026-01-20T10:00:00Z",
    }),
  ];

  for (const d of docs) {
    testDb.insert(schema.documents).values(d).run();
  }
});

// ── POST /v1/documents/upload — Auth ──

describe("POST /v1/documents/upload - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await uploadDocument(makeFormData());
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await uploadDocument(makeFormData(), headers);
    expect(res.status).toBe(403);
  });
});

// ── POST /v1/documents/upload — Validation ──

describe("POST /v1/documents/upload - Validation", () => {
  it("returns 400 when client_id is missing", async () => {
    const headers = await authHeader(["ecm:documents:upload"]);
    const fd = makeFormData({ client_id: null as any });
    const res = await uploadDocument(fd, headers);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when document_type is invalid", async () => {
    const headers = await authHeader(["ecm:documents:upload"]);
    const fd = makeFormData({ document_type: "invalid_type" });
    const res = await uploadDocument(fd, headers);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error_code).toBe("VALIDATION_ERROR");
  });

  it("returns 400 when file is missing", async () => {
    const headers = await authHeader(["ecm:documents:upload"]);
    const fd = makeFormData({ file: null as any });
    const res = await uploadDocument(fd, headers);
    expect(res.status).toBe(400);
  });
});

// ── POST /v1/documents/upload — Success ──

describe("POST /v1/documents/upload - Success", () => {
  it("creates a document and returns 201", async () => {
    const headers = await authHeader(["ecm:documents:upload"]);
    const fd = makeFormData();
    const res = await uploadDocument(fd, headers);
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.document_id).toMatch(/^doc_/);
    expect(json.filename).toBe("test.pdf");
    expect(json.mime_type).toBe("application/pdf");
    expect(json.status).toBe("uploaded");
    expect(json.upload_date).toBeTruthy();
  });

  it("stores tags when provided", async () => {
    const headers = await authHeader(["ecm:documents:upload"]);
    const fd = makeFormData();
    fd.append("tags", "auto");
    fd.append("tags", "new_business");
    const res = await uploadDocument(fd, headers);
    expect(res.status).toBe(201);

    const json = await res.json();
    // Verify it was stored in DB with tags
    const [row] = testDb
      .select()
      .from(schema.documents)
      .where(
        require("drizzle-orm").eq(
          schema.documents.document_id,
          json.document_id,
        ),
      )
      .all();
    const tags = JSON.parse(row.tags);
    expect(tags).toContain("auto");
    expect(tags).toContain("new_business");
  });
});

// ── GET /v1/documents/:client_id/audit — Auth ──

describe("GET /v1/documents/:client_id/audit - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await getAudit("CLI-001");
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ecm:documents:upload"]);
    const res = await getAudit("CLI-001", {}, headers);
    expect(res.status).toBe(403);
  });
});

// ── GET /v1/documents/:client_id/audit — Basic ──

describe("GET /v1/documents/:client_id/audit - Basic", () => {
  it("returns documents for a client sorted by upload_date desc", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-001", {}, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.client_id).toBe("CLI-001");
    expect(json.documents.length).toBeGreaterThanOrEqual(3);
    // Sorted by upload_date desc
    for (let i = 1; i < json.documents.length; i++) {
      expect(json.documents[i - 1].upload_date >= json.documents[i].upload_date).toBe(true);
    }
  });

  it("parses tags as arrays", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-001", {}, headers);
    const json = await res.json();
    const doc = json.documents.find((d: any) => d.document_id === "doc_001");
    expect(Array.isArray(doc.tags)).toBe(true);
    expect(doc.tags).toContain("auto");
  });

  it("returns 404 for client with no documents", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-NONEXISTENT", {}, headers);
    expect(res.status).toBe(404);
  });
});

// ── GET /v1/documents/:client_id/audit — Compliance ──

describe("GET /v1/documents/:client_id/audit - Compliance", () => {
  it("detects expired documents", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-001", {}, headers);
    const json = await res.json();
    // CLI-001 has both required types but has an expired doc
    expect(json.compliance_status).toBe("expired_documents");
  });

  it("detects missing required documents", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-003", {}, headers);
    const json = await res.json();
    expect(json.compliance_status).toBe("missing_documents");
    expect(json.missing_documents.length).toBeGreaterThan(0);
    expect(json.missing_documents[0].document_type).toBe("signed_application");
    expect(json.missing_documents[0].reason).toBeTruthy();
  });

  it("reports compliant when all required docs present and none expired", async () => {
    // CLI-002 only has a COI — it's missing signed_application AND id_verification
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-002", {}, headers);
    const json = await res.json();
    expect(json.compliance_status).toBe("missing_documents");
  });
});

// ── GET /v1/documents/:client_id/audit — Pagination ──

describe("GET /v1/documents/:client_id/audit - Pagination", () => {
  it("paginates with limit", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-001", { limit: "2" }, headers);
    const json = await res.json();
    expect(json.documents.length).toBe(2);
    expect(json.pagination.has_more).toBe(true);
    expect(json.pagination.next_cursor).toBeTruthy();
  });

  it("follows cursor to next page", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res1 = await getAudit("CLI-001", { limit: "2" }, headers);
    const json1 = await res1.json();

    const res2 = await getAudit(
      "CLI-001",
      { limit: "2", cursor: json1.pagination.next_cursor },
      headers,
    );
    const json2 = await res2.json();

    // No overlap
    const ids1 = json1.documents.map((d: any) => d.document_id);
    const ids2 = json2.documents.map((d: any) => d.document_id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);
  });
});

// ── GET /v1/documents/:client_id/audit — Status Filter ──

describe("GET /v1/documents/:client_id/audit - Status Filter", () => {
  it("filters documents by status", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-001", { status: "uploaded" }, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    for (const doc of json.documents) {
      expect(doc.status).toBe("uploaded");
    }
    expect(json.documents.length).toBeGreaterThan(0);
  });

  it("returns 400 for invalid status value", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-001", { status: "bogus" }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 404 when status filter matches no docs for client", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await getAudit("CLI-001", { status: "generated" }, headers);
    expect(res.status).toBe(404);
  });
});

// ── GET /v1/documents — Auth ──

describe("GET /v1/documents - Auth", () => {
  it("returns 401 without token", async () => {
    const res = await listDocuments();
    expect(res.status).toBe(401);
  });

  it("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ecm:documents:upload"]);
    const res = await listDocuments({}, headers);
    expect(res.status).toBe(403);
  });
});

// ── GET /v1/documents — Basic ──

describe("GET /v1/documents - Basic", () => {
  it("returns documents across all clients", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({}, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBeGreaterThanOrEqual(6);
    expect(json.pagination).toBeDefined();

    // Documents from multiple clients
    const clientIds = new Set(json.data.map((d: any) => d.client_id));
    expect(clientIds.size).toBeGreaterThan(1);
  });

  it("returns documents sorted by upload_date desc", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({}, headers);
    const json = await res.json();
    for (let i = 1; i < json.data.length; i++) {
      expect(json.data[i - 1].upload_date >= json.data[i].upload_date).toBe(true);
    }
  });

  it("parses tags as arrays", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({}, headers);
    const json = await res.json();
    for (const doc of json.data) {
      expect(Array.isArray(doc.tags)).toBe(true);
    }
  });
});

// ── GET /v1/documents — Filters ──

describe("GET /v1/documents - Filters", () => {
  it("filters by status", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({ status: "generated" }, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    for (const doc of json.data) {
      expect(doc.status).toBe("generated");
    }
  });

  it("filters by document_type", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({ document_type: "coi" }, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    for (const doc of json.data) {
      expect(doc.document_type).toBe("coi");
    }
  });

  it("filters by date_from", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({ date_from: "2026-02-14T00:00:00Z" }, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    for (const doc of json.data) {
      expect(doc.upload_date >= "2026-02-14T00:00:00Z").toBe(true);
    }
  });

  it("filters by date_to", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({ date_to: "2026-02-11T00:00:00Z" }, headers);
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    for (const doc of json.data) {
      expect(doc.upload_date <= "2026-02-11T00:00:00Z").toBe(true);
    }
  });

  it("combines multiple filters", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments(
      { status: "uploaded", document_type: "id_verification" },
      headers,
    );
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    for (const doc of json.data) {
      expect(doc.status).toBe("uploaded");
      expect(doc.document_type).toBe("id_verification");
    }
  });

  it("returns 400 for invalid status", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({ status: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid document_type", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({ document_type: "invalid" }, headers);
    expect(res.status).toBe(400);
  });
});

// ── GET /v1/documents — Pagination ──

describe("GET /v1/documents - Pagination", () => {
  it("paginates with limit", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({ limit: "2" }, headers);
    const json = await res.json();
    expect(json.data.length).toBe(2);
    expect(json.pagination.has_more).toBe(true);
    expect(json.pagination.next_cursor).toBeTruthy();
  });

  it("follows cursor to next page", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res1 = await listDocuments({ limit: "3" }, headers);
    const json1 = await res1.json();

    const res2 = await listDocuments(
      { limit: "3", cursor: json1.pagination.next_cursor },
      headers,
    );
    const json2 = await res2.json();

    const ids1 = json1.data.map((d: any) => d.document_id);
    const ids2 = json2.data.map((d: any) => d.document_id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);
  });
});

// ── GET /v1/documents - additional filter combinations ──

describe("GET /v1/documents - date range filters", () => {
  it("combines date_from and date_to for a narrow window", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments(
      { date_from: "2026-02-13T00:00:00Z", date_to: "2026-02-14T23:59:59Z" },
      headers,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    for (const doc of json.data) {
      expect(doc.upload_date >= "2026-02-13T00:00:00Z").toBe(true);
      expect(doc.upload_date <= "2026-02-14T23:59:59Z").toBe(true);
    }
  });

  it("returns empty data when date range matches nothing", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments(
      { date_from: "2020-01-01T00:00:00Z", date_to: "2020-12-31T23:59:59Z" },
      headers,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });
});

describe("GET /v1/documents - combined status and date filters", () => {
  it("filters by status and date_from", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments(
      { status: "uploaded", date_from: "2026-02-14T00:00:00Z" },
      headers,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    for (const doc of json.data) {
      expect(doc.status).toBe("uploaded");
      expect(doc.upload_date >= "2026-02-14T00:00:00Z").toBe(true);
    }
  });

  it("filters by document_type and date_to", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments(
      { document_type: "endorsement", date_to: "2026-02-01T00:00:00Z" },
      headers,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(1);
    expect(json.data[0].document_type).toBe("endorsement");
  });
});

describe("GET /v1/documents - response shape", () => {
  it("each document has all expected fields", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({}, headers);
    const json = await res.json();
    const doc = json.data[0];
    expect(doc).toHaveProperty("document_id");
    expect(doc).toHaveProperty("client_id");
    expect(doc).toHaveProperty("document_type");
    expect(doc).toHaveProperty("filename");
    expect(doc).toHaveProperty("mime_type");
    expect(doc).toHaveProperty("file_size_bytes");
    expect(doc).toHaveProperty("status");
    expect(doc).toHaveProperty("upload_date");
    expect(doc).toHaveProperty("tags");
  });

  it("pagination has expected structure", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({}, headers);
    const json = await res.json();
    expect(json.pagination).toHaveProperty("limit");
    expect(json.pagination).toHaveProperty("has_more");
    expect(typeof json.pagination.limit).toBe("number");
    expect(typeof json.pagination.has_more).toBe("boolean");
  });
});

describe("GET /v1/documents - all valid document_type values", () => {
  const validTypes = ["signed_application", "id_verification", "coi", "dec_page", "endorsement", "cancellation_notice", "welcome_kit"];

  for (const docType of validTypes) {
    it(`accepts document_type=${docType} filter`, async () => {
      const headers = await authHeader(["ecm:documents:read"]);
      const res = await listDocuments({ document_type: docType }, headers);
      expect(res.status).toBe(200);
      const json = await res.json();
      for (const doc of json.data) {
        expect(doc.document_type).toBe(docType);
      }
    });
  }
});

describe("GET /v1/documents - all valid status values", () => {
  const validStatuses = ["uploaded", "pending_signature", "signed", "expired", "generated"];

  for (const s of validStatuses) {
    it(`accepts status=${s} filter`, async () => {
      const headers = await authHeader(["ecm:documents:read"]);
      const res = await listDocuments({ status: s }, headers);
      expect(res.status).toBe(200);
      const json = await res.json();
      for (const doc of json.data) {
        expect(doc.status).toBe(s);
      }
    });
  }
});

// ── GET /v1/documents - client_id filter ──

describe("GET /v1/documents - client_id filter", () => {
  it("filters by client_id", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({ client_id: "CLI-001" }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBeGreaterThan(0);
    for (const doc of json.data) {
      expect(doc.client_id).toBe("CLI-001");
    }
  });

  it("returns empty for nonexistent client_id", async () => {
    const headers = await authHeader(["ecm:documents:read"]);
    const res = await listDocuments({ client_id: "CLI-NONE" }, headers);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.length).toBe(0);
  });
});
