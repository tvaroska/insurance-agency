import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import {
  requireScopes,
  checkEnum,
  throwIfErrors,
  type AuthVariables,
  type CorrelationVariables,
} from "@evergreen/shared";
import { db } from "../db";
import { adjusters, claims } from "../schema";

type AppVariables = CorrelationVariables & AuthVariables;

const adjustersRouter = new Hono<{ Variables: AppVariables }>();

const SPECIALTIES = ["auto", "property", "liability", "general"] as const;

// ── GET / — List adjusters ──

adjustersRouter.get("/", requireScopes("claims:read"), async (c) => {
  const query = c.req.query();

  throwIfErrors([
    checkEnum("specialty", query.specialty, SPECIALTIES),
    query.active !== undefined
      ? checkEnum("active", query.active, ["0", "1"])
      : null,
  ]);

  const rows = await db.select().from(adjusters);

  // Apply filters in JS (small dataset)
  let filtered = rows;
  if (query.specialty) {
    filtered = filtered.filter((a) => a.specialty === query.specialty);
  }
  if (query.active !== undefined) {
    const activeVal = parseInt(query.active, 10);
    filtered = filtered.filter((a) => a.active === activeVal);
  }

  // Count open claims per adjuster
  const openCounts = db
    .select({
      adjuster_id: claims.adjuster_id,
      count: sql<number>`count(*)`,
    })
    .from(claims)
    .where(sql`${claims.status} NOT IN ('settled', 'denied')`)
    .groupBy(claims.adjuster_id)
    .all();

  const countMap = new Map(
    openCounts.map((r) => [r.adjuster_id, r.count]),
  );

  const data = filtered.map((a) => ({
    ...a,
    open_claims_count: countMap.get(a.adjuster_id) ?? 0,
  }));

  return c.json({ data });
});

export { adjustersRouter };
