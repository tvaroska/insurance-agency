import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { expectError, loadContract } from "../harness";
import { book, fieldCodes, ISO_UTC, start, task, TASK_GAPS, TASK_ID, type Ctx } from "./support";

const contract = loadContract("ams");
let ctx: Ctx;

beforeAll(async () => {
  ctx = await start();
}, 30_000);
beforeEach(async () => {
  await ctx.svc.seed({
    tables: book({
      tasks: [
        task("T-1", {
          due_date: "2026-03-01",
          status: "open",
          priority: "high",
          assigned_to: "USR-1",
          related_client_id: "CLI-A",
          related_policy_id: "POL-A-AUTO",
          description: "Call about renewal.",
          task_type: "renewal",
        }),
        task("T-2", { due_date: "2026-01-15", status: "in_progress", priority: "medium", assigned_to: "USR-2", related_client_id: "CLI-B" }),
        task("T-3", { due_date: "2026-03-01", status: "completed", priority: "urgent", assigned_to: "USR-1" }),
        task("T-4", { due_date: null, status: "blocked", priority: "low", related_client_id: "CLI-A" }),
      ],
    }),
  });
});

const ids = (res: { body: any }) => res.body.data.map((t: any) => t.id);
const list = (query: Record<string, string> = {}) => ctx.api.get("/v1/tasks", { query });

describe("listTasks", () => {
  test("AMS-R63: tasks are sorted by due date, earliest first, then by id; tasks without a due date come first", async () => {
    const res = await list();
    expect(res.status).toBe(200);
    expect(ids(res)).toEqual(["T-4", "T-2", "T-1", "T-3"]);
    contract.check(res, { allow: TASK_GAPS });
  });

  test("AMS-R5, AMS-R63: a task carries both names for its client and policy links", async () => {
    const res = await list({ status: "open" });
    expect(res.body.data).toEqual([
      {
        id: "T-1",
        title: "Task T-1",
        description: "Call about renewal.",
        status: "open",
        priority: "high",
        task_type: "renewal",
        assigned_to: "USR-1",
        client_id: "CLI-A",
        policy_id: "POL-A-AUTO",
        related_client_id: "CLI-A",
        related_policy_id: "POL-A-AUTO",
        due_date: "2026-03-01",
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      },
    ]);
  });

  test("AMS-R64: status, priority and assignee filter exactly and combine with AND", async () => {
    expect(ids(await list({ status: "blocked" }))).toEqual(["T-4"]);
    expect(ids(await list({ priority: "urgent" }))).toEqual(["T-3"]);
    expect(ids(await list({ assigned_to: "USR-1" }))).toEqual(["T-1", "T-3"]);
    expect(ids(await list({ assigned_to: "USR-1", status: "completed" }))).toEqual(["T-3"]);
    expect(ids(await list({ assigned_to: "USR-2", status: "completed" }))).toEqual([]);
  });

  test("AMS-R64: the client and policy filters accept both names, and the related_ name wins", async () => {
    expect(ids(await list({ client_id: "CLI-A" }))).toEqual(["T-4", "T-1"]);
    expect(ids(await list({ related_client_id: "CLI-A" }))).toEqual(["T-4", "T-1"]);
    expect(ids(await list({ related_client_id: "CLI-B", client_id: "CLI-A" }))).toEqual(["T-2"]);
    expect(ids(await list({ policy_id: "POL-A-AUTO" }))).toEqual(["T-1"]);
    expect(ids(await list({ related_policy_id: "POL-A-AUTO" }))).toEqual(["T-1"]);
    expect(ids(await list({ related_policy_id: "POL-ZZ", policy_id: "POL-A-AUTO" }))).toEqual([]);
  });

  test("AMS-R64, AMS-R2: the due-date range is inclusive, and tasks without a due date never match it", async () => {
    expect(ids(await list({ due_date_before: "2026-03-01" }))).toEqual(["T-2", "T-1", "T-3"]);
    expect(ids(await list({ due_date_before: "2026-02-28" }))).toEqual(["T-2"]);
    expect(ids(await list({ due_date_after: "2026-03-01" }))).toEqual(["T-1", "T-3"]);
    expect(ids(await list({ due_date_after: "2026-01-15", due_date_before: "2026-01-15" }))).toEqual(["T-2"]);
  });

  test("AMS-R65: the filters are validated together, in the documented order", async () => {
    const res = await list({ status: "done", priority: "asap", due_date_before: "soon", due_date_after: "1/1/26" });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      { field: "status", message: "status must be one of: open, in_progress, blocked, completed, cancelled.", code: "invalid_enum" },
      { field: "priority", message: "priority must be one of: low, medium, high, urgent.", code: "invalid_enum" },
      { field: "due_date_before", message: "due_date_before must be YYYY-MM-DD.", code: "invalid_format" },
      { field: "due_date_after", message: "due_date_after must be YYYY-MM-DD.", code: "invalid_format" },
    ]);
    contract.check(res);
  });

  test("AMS-R65: empty filter values are ignored", async () => {
    const res = await list({ status: "", priority: "", due_date_before: "", due_date_after: "" });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(4);
  });
});

describe("createTask", () => {
  test("AMS-R66: the body is validated in one step, in the documented order", async () => {
    const res = await ctx.api.post("/v1/tasks", {
      title: "t".repeat(501),
      description: "d".repeat(5001),
      priority: "asap",
      due_date: "tomorrow",
    });
    expectError(res, 400, "VALIDATION_ERROR");
    expect(res.body.details).toEqual([
      { field: "title", message: "title must be at most 500 characters.", code: "too_long" },
      { field: "description", message: "description must be at most 5000 characters.", code: "too_long" },
      { field: "priority", message: "priority must be one of: low, medium, high, urgent.", code: "invalid_enum" },
      { field: "due_date", message: "due_date must be YYYY-MM-DD.", code: "invalid_format" },
    ]);
    contract.check(res);
    expect(fieldCodes(await ctx.api.post("/v1/tasks", {}))).toEqual(["title:required"]);
  });

  test("AMS-R15, AMS-R66: optional fields sent as empty strings are checked like any other value", async () => {
    const res = await ctx.api.post("/v1/tasks", { title: "", priority: "", due_date: "" });
    expect(fieldCodes(res)).toEqual(["title:required", "priority:invalid_enum", "due_date:invalid_format"]);
  });

  test("AMS-R66: a 500-character title and a 5000-character description are accepted; null description and due date too", async () => {
    const long = await ctx.api.post("/v1/tasks", { title: "t".repeat(500), description: "d".repeat(5000) });
    expect(long.status).toBe(201);
    const nulls = await ctx.api.post("/v1/tasks", { title: "Nulls", description: null, due_date: null });
    expect(nulls.status).toBe(201);
    expect(nulls.body).toMatchObject({ description: null, due_date: null });
  });

  test("AMS-R67: a minimal create fills the defaults and inserts one open task", async () => {
    const { result, diff } = await ctx.svc.changes(() => ctx.api.post("/v1/tasks", { title: "Follow up" }));
    expect(result.status).toBe(201);
    expect(result.body.id).toMatch(TASK_ID);
    expect(result.body).toEqual({
      id: result.body.id,
      title: "Follow up",
      description: null,
      status: "open",
      priority: "medium",
      task_type: null,
      assigned_to: null,
      client_id: null,
      policy_id: null,
      related_client_id: null,
      related_policy_id: null,
      due_date: null,
      created_at: result.body.created_at,
      updated_at: result.body.created_at,
    });
    expect(result.body.created_at).toMatch(ISO_UTC);
    contract.check(result, { allow: TASK_GAPS });

    expect(Object.keys(diff)).toEqual(["tasks"]);
    expect(diff.tasks.changed).toEqual([]);
    expect(diff.tasks.added).toEqual([
      {
        id: result.body.id,
        title: "Follow up",
        description: null,
        status: "open",
        priority: "medium",
        task_type: null,
        assigned_to: null,
        related_client_id: null,
        related_policy_id: null,
        due_date: null,
        created_at: result.body.created_at,
        updated_at: result.body.created_at,
      },
    ]);
  });

  test("AMS-R67: the status is always open, and the other fields are stored as given", async () => {
    const res = await ctx.api.post("/v1/tasks", {
      title: "Remarket",
      description: "Get three quotes.",
      status: "completed",
      priority: "urgent",
      task_type: "remarketing",
      assigned_to: "USR-9",
      due_date: "2026-05-01",
      client_id: "CLI-A",
      policy_id: "POL-A-AUTO",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: "open",
      description: "Get three quotes.",
      priority: "urgent",
      task_type: "remarketing",
      assigned_to: "USR-9",
      due_date: "2026-05-01",
      client_id: "CLI-A",
      related_client_id: "CLI-A",
      policy_id: "POL-A-AUTO",
      related_policy_id: "POL-A-AUTO",
    });
  });

  test("AMS-R67: related_client_id and related_policy_id win over client_id and policy_id; links are not checked", async () => {
    const res = await ctx.api.post("/v1/tasks", {
      title: "Links",
      related_client_id: "GHOST-1",
      client_id: "CLI-A",
      related_policy_id: "GHOST-2",
      policy_id: "POL-A-AUTO",
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ client_id: "GHOST-1", related_client_id: "GHOST-1", policy_id: "GHOST-2", related_policy_id: "GHOST-2" });
    const row = (await ctx.svc.table("tasks")).find((r) => r.id === res.body.id)!;
    expect(row).toMatchObject({ related_client_id: "GHOST-1", related_policy_id: "GHOST-2" });
    expect("client_id" in row).toBe(false);
  });
});

describe("updateTask", () => {
  test("AMS-R68: a body without status, priority, assigned_to, due_date or description is rejected", async () => {
    for (const body of [{}, { title: "New title", task_type: "x", client_id: "CLI-B" }]) {
      const { result, diff } = await ctx.svc.changes(() => ctx.api.patch("/v1/tasks/T-1", body));
      expectError(result, 400, "VALIDATION_ERROR");
      expect(result.body.details).toEqual([
        {
          field: "body",
          message: "Request body must contain at least one updatable field: status, priority, assigned_to, due_date, description.",
          code: "required",
        },
      ]);
      expect(diff).toEqual({});
      contract.check(result);
    }
  });

  test("AMS-R69: present fields are validated together, in the documented order", async () => {
    const res = await ctx.api.patch("/v1/tasks/T-1", { status: "done", priority: "asap", due_date: "soon", description: "d".repeat(5001) });
    expect(fieldCodes(res)).toEqual(["status:invalid_enum", "priority:invalid_enum", "due_date:invalid_format", "description:too_long"]);
    expect(res.body.details[2].message).toBe("due_date must be YYYY-MM-DD.");
  });

  test("AMS-R70: validation comes before the existence check; a valid body for an unknown id is 404", async () => {
    expectError(await ctx.api.patch("/v1/tasks/T-ZZ", { status: "done" }), 400, "VALIDATION_ERROR");
    const res = await ctx.api.patch("/v1/tasks/T-ZZ", { status: "open" });
    expectError(res, 404, "NOT_FOUND");
    expect(res.body.message).toBe("task not found.");
    contract.check(res);
  });

  test("AMS-R71: only the fields sent change, and updated_at moves", async () => {
    const { result, diff } = await ctx.svc.changes(() =>
      ctx.api.patch("/v1/tasks/T-1", { status: "in_progress", priority: "low", title: "ignored", task_type: "ignored", client_id: "CLI-B" }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      id: "T-1",
      title: "Task T-1",
      status: "in_progress",
      priority: "low",
      task_type: "renewal",
      assigned_to: "USR-1",
      client_id: "CLI-A",
      due_date: "2026-03-01",
      description: "Call about renewal.",
      created_at: "2025-01-01T00:00:00.000Z",
    });
    expect(result.body.updated_at).toMatch(ISO_UTC);
    expect(result.body.updated_at).not.toBe("2025-01-01T00:00:00.000Z");
    contract.check(result, { allow: TASK_GAPS });

    expect(Object.keys(diff)).toEqual(["tasks"]);
    expect(diff.tasks.changed.map((c) => c.key)).toEqual(["T-1"]);
    expect(diff.tasks.changed[0].fields.sort()).toEqual(["priority", "status", "updated_at"]);
  });

  test("AMS-R71: assigned_to, due_date and description can be set and cleared with null", async () => {
    const set = await ctx.api.patch("/v1/tasks/T-4", { assigned_to: "USR-7", due_date: "2026-04-04", description: "Now described." });
    expect(set.body).toMatchObject({ assigned_to: "USR-7", due_date: "2026-04-04", description: "Now described." });
    const cleared = await ctx.api.patch("/v1/tasks/T-4", { assigned_to: null, due_date: null, description: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toMatchObject({ assigned_to: null, due_date: null, description: null });
  });

  test("AMS-R71: any status may follow any other", async () => {
    const statuses = ["open", "in_progress", "blocked", "completed", "cancelled"];
    for (const from of statuses) {
      for (const to of statuses) {
        await ctx.api.patch("/v1/tasks/T-3", { status: from });
        const res = await ctx.api.patch("/v1/tasks/T-3", { status: to });
        expect([from, to, res.status, res.body.status]).toEqual([from, to, 200, to]);
      }
    }
  });
});

test.todo("AMS-G8: Task.title maxLength is 250 in specs/ams.yaml; the service accepts up to 500 characters", () => {});
test.todo("AMS-G9: specs/ams.yaml says listTasks breaks due-date ties by created_at descending; the service uses id ascending", () => {});
test.todo("AMS-G13: specs/ams.yaml documents 409 on updateTask; the service never returns it", () => {});
