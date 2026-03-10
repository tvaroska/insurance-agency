import { mock } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import * as schema from "../schema";

const testSqlite = new Database(":memory:");
testSqlite.exec("PRAGMA foreign_keys = ON;");
const testDb = drizzle(testSqlite, { schema });

mock.module("../db", () => ({ db: testDb, sqlite: testSqlite }));

import { describe, expect, test, beforeAll, beforeEach } from "bun:test";
import { tasksRouter } from "../routes/tasks";
import { createTables, createTestApp, authHeader, makeTask } from "./setup";

const app = createTestApp({ tasks: tasksRouter });

beforeAll(() => {
  createTables(testSqlite);
});

beforeEach(() => {
  testSqlite.exec("DELETE FROM tasks");

  const taskRows = [
    makeTask({ id: "TASK-001", title: "Follow up with client", status: "open", priority: "medium", assigned_to: "agent-1", due_date: "2025-06-01", related_client_id: "CL-001" }),
    makeTask({ id: "TASK-002", title: "Review renewal", status: "in_progress", priority: "high", assigned_to: "agent-2", due_date: "2025-05-15", related_client_id: "CL-002" }),
    makeTask({ id: "TASK-003", title: "Send documents", status: "open", priority: "urgent", assigned_to: "agent-1", due_date: "2025-07-01" }),
    makeTask({ id: "TASK-004", title: "Completed item", status: "completed", priority: "low", assigned_to: null, due_date: "2025-04-01" }),
  ];

  for (const row of taskRows) {
    testDb.insert(schema.tasks).values(row).run();
  }
});

// ── Helpers ──

function postTask(body: any, headers: Record<string, string> = {}) {
  return app.request("/v1/tasks", {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getTasks(params: Record<string, string> = {}, headers: Record<string, string> = {}) {
  const url = new URL("http://localhost/v1/tasks");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return app.request(url.toString(), { headers });
}

function patchTask(taskId: string, body: any, headers: Record<string, string>) {
  return app.request(`/v1/tasks/${taskId}`, {
    method: "PATCH",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── GET /v1/tasks ──

describe("GET /v1/tasks - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await getTasks();
    expect(res.status).toBe(401);
  });

  test("returns 403 with wrong scope", async () => {
    const headers = await authHeader(["ams:clients:read"]);
    const res = await getTasks({}, headers);
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/tasks - listing", () => {
  test("returns all tasks with pagination", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({}, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeArray();
    expect(body.data.length).toBe(4);
    expect(body.pagination).toBeDefined();
  });

  test("orders by due_date ascending", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({}, headers);
    const body = await res.json();
    const dates = body.data.map((t: any) => t.due_date);
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i] >= dates[i - 1]).toBe(true);
    }
  });
});

describe("GET /v1/tasks - filters", () => {
  test("filters by status", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({ status: "open" }, headers);
    const body = await res.json();
    expect(body.data.length).toBe(2);
    for (const t of body.data) {
      expect(t.status).toBe("open");
    }
  });

  test("filters by priority", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({ priority: "high" }, headers);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].priority).toBe("high");
  });

  test("filters by assigned_to", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({ assigned_to: "agent-1" }, headers);
    const body = await res.json();
    expect(body.data.length).toBe(2);
  });

  test("filters by client_id", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({ client_id: "CL-001" }, headers);
    const body = await res.json();
    expect(body.data.length).toBe(1);
    expect(body.data[0].client_id).toBe("CL-001");
  });

  test("filters by due_date_before", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({ due_date_before: "2025-06-01" }, headers);
    const body = await res.json();
    for (const t of body.data) {
      expect(t.due_date <= "2025-06-01").toBe(true);
    }
  });

  test("filters by due_date_after", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({ due_date_after: "2025-06-01" }, headers);
    const body = await res.json();
    for (const t of body.data) {
      expect(t.due_date >= "2025-06-01").toBe(true);
    }
  });

  test("returns 400 for invalid status", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({ status: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid due_date_before format", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const res = await getTasks({ due_date_before: "June 1" }, headers);
    expect(res.status).toBe(400);
  });
});

describe("GET /v1/tasks - pagination", () => {
  test("cursor pagination traverses all results", async () => {
    const headers = await authHeader(["ams:tasks:read"]);
    const allIds = new Set<string>();
    let url = "/v1/tasks?limit=2";

    while (true) {
      const res = await app.request(url, { headers });
      expect(res.status).toBe(200);
      const body = await res.json();

      for (const t of body.data) {
        allIds.add(t.id);
      }

      if (!body.pagination.has_more) break;
      expect(body.pagination.next_cursor).toBeTruthy();
      url = `/v1/tasks?limit=2&cursor=${body.pagination.next_cursor}`;
    }

    expect(allIds.size).toBe(4);
  });
});

// ── POST /v1/tasks ──

describe("POST /v1/tasks - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await postTask({ title: "Test task" });
    expect(res.status).toBe(401);
  });
});

describe("POST /v1/tasks - validation", () => {
  test("returns 400 when title missing", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await postTask({ description: "No title" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid priority", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await postTask({ title: "Test", priority: "critical" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid due_date format", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await postTask({ title: "Test", due_date: "June 1" }, headers);
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/tasks - success", () => {
  test("creates task with required fields and defaults", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await postTask({ title: "New task" }, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toStartWith("TASK-");
    expect(body.title).toBe("New task");
    expect(body.status).toBe("open");
    expect(body.priority).toBe("medium");
    expect(body.created_at).toBeDefined();
  });

  test("creates task with all fields", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await postTask({
      title: "Full task",
      description: "Detailed description",
      priority: "urgent",
      assigned_to: "agent-3",
      due_date: "2025-08-01",
      client_id: "CL-001",
      policy_id: "POL-001",
      task_type: "follow_up",
    }, headers);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.title).toBe("Full task");
    expect(body.priority).toBe("urgent");
    expect(body.assigned_to).toBe("agent-3");
    expect(body.due_date).toBe("2025-08-01");
    expect(body.client_id).toBe("CL-001");
    expect(body.policy_id).toBe("POL-001");
    expect(body.task_type).toBe("follow_up");
  });
});

// ── PATCH /v1/tasks/:id ──

describe("PATCH /v1/tasks/:id - auth", () => {
  test("returns 401 without auth", async () => {
    const res = await patchTask("TASK-001", { status: "completed" }, {});
    expect(res.status).toBe(401);
  });
});

describe("PATCH /v1/tasks/:id - successful updates", () => {
  test("returns 200 with full updated task", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { status: "in_progress" }, headers);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe("TASK-001");
    expect(body.status).toBe("in_progress");
    expect(body.title).toBe("Follow up with client");
    expect(body.updated_at).toBeDefined();
  });

  test("updates status", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { status: "completed" }, headers);
    const body = await res.json();
    expect(body.status).toBe("completed");
  });

  test("updates priority", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { priority: "urgent" }, headers);
    const body = await res.json();
    expect(body.priority).toBe("urgent");
  });

  test("sets assigned_to to null", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { assigned_to: null }, headers);
    const body = await res.json();
    expect(body.assigned_to).toBeNull();
  });

  test("sets due_date to null", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { due_date: null }, headers);
    const body = await res.json();
    expect(body.due_date).toBeNull();
  });

  test("updates description", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { description: "New description" }, headers);
    const body = await res.json();
    expect(body.description).toBe("New description");
  });
});

describe("PATCH /v1/tasks/:id - validation", () => {
  test("returns 404 for nonexistent task", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("NONEXISTENT", { status: "open" }, headers);
    expect(res.status).toBe(404);
  });

  test("returns 400 when no updatable fields present", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { random_field: "value" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid status enum", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { status: "invalid" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid priority enum", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { priority: "critical" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid due_date format", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { due_date: "June 1" }, headers);
    expect(res.status).toBe(400);
  });

  test("returns 400 for description exceeding 5000 chars", async () => {
    const headers = await authHeader(["ams:tasks:write"]);
    const res = await patchTask("TASK-001", { description: "x".repeat(5001) }, headers);
    expect(res.status).toBe(400);
  });
});
