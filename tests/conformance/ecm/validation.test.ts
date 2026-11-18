import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectStatus, type Tables } from "../harness";
import { start, type Ctx } from "./support";

const REPO_ROOT = join(import.meta.dir, "../../..");

function loadFixture(file: string): { description: string; tables: Tables } {
  return JSON.parse(readFileSync(join(REPO_ROOT, "data/validation/ecm", file), "utf8"));
}

describe("held-out validation fixtures (data/validation/ecm)", () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  test("ECM-R10, ECM-R110: 115-document cursor walk and envelope expiry without touching completed envelopes", async () => {
    const fixture = loadFixture("stress-documents-and-envelopes.json");
    await ctx.svc.seed({ base: "empty", tables: fixture.tables });

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    while (true) {
      const res = await ctx.api.get("/v1/documents", { query: { limit: 200, cursor } });
      const body = expectStatus(res, 200);
      expect(body.pagination.limit).toBe(100);
      for (const row of body.data) seen.push(row.document_id);
      pages += 1;
      if (!body.pagination.has_more) break;
      cursor = body.pagination.next_cursor;
      if (pages > 5) throw new Error("pagination did not terminate");
    }
    expect(pages).toBe(2);
    expect(seen.length).toBe(115);
    expect(new Set(seen).size).toBe(115);

    // Time travel +3 days expires ENV-VAL-EXP (sent) and leaves ENV-VAL-DONE (completed) untouched.
    const tt = await ctx.svc.timeTravel({ days: 3 });
    expect(tt).toMatchObject({
      status: "ok",
      service: "ecm",
      days_advanced: 3,
      transitions: { envelopes_expired: 1 },
    });
    const envelopes = await ctx.svc.table("envelopes");
    const byId = Object.fromEntries(envelopes.map((e: any) => [e.envelope_id, e.status]));
    expect(byId["ENV-VAL-EXP"]).toBe("expired");
    expect(byId["ENV-VAL-DONE"]).toBe("completed");
  });
});
