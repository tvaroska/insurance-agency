import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectStatus, type Tables } from "../harness";
import { start, tool, type Ctx } from "./support";

const REPO_ROOT = join(import.meta.dir, "../../..");

function loadFixture(file: string): { description: string; tables: Tables } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data/validation/comm", file), "utf8"));
}

describe("held-out validation fixtures (data/validation/comm)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("COMM-R20, COMM-R12, COMM-R46: 115-message inbox pagination, MCP parity, and selective webhook expiry", async () => {
    const fixture = loadFixture("stress-inbox-and-webhooks.json");
    await ctx.svc.seed({ base: "empty", tables: fixture.tables });

    // Walk all 115 messages via REST cursor pagination.
    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    while (true) {
      const res = await ctx.api.get("/v1/messages/inbox", { query: { limit: 100, cursor } });
      const body = expectStatus(res, 200);
      for (const row of body.data) seen.push(row.message_id);
      pages += 1;
      if (!body.pagination.has_more) break;
      cursor = body.pagination.next_cursor;
      if (pages > 5) throw new Error("pagination did not terminate");
    }
    expect(pages).toBe(2);
    expect(seen.length).toBe(115);
    expect(new Set(seen).size).toBe(115);

    // MCP get_inbox filtered by client_id matches REST filtered count.
    const restClient1 = expectStatus(
      await ctx.api.get("/v1/messages/inbox", { query: { client_id: "CLI-VAL-1", limit: 100 } }),
      200,
    );
    const mcpClient1 = await tool(ctx.api, "get_inbox", { client_id: "CLI-VAL-1", limit: 100 });
    expect(mcpClient1.data.length).toBe(restClient1.data.length);

    // Time travel +3 days fails only overdue del_val_overdue and leaves del_val_future pending.
    const tt = await ctx.svc.timeTravel({ days: 3 });
    expect(tt).toMatchObject({
      status: "ok",
      service: "comm",
      days_advanced: 3,
      transitions: { webhook_deliveries_expired: 1 },
    });
    const deliveries = await ctx.svc.table("webhook_deliveries");
    const byId = Object.fromEntries(deliveries.map((d: any) => [d.delivery_id, d.status]));
    expect(byId["del_val_overdue"]).toBe("failed");
    expect(byId["del_val_future"]).toBe("pending");
  });
});
