import { beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expectedServiceMode } from "../harness";
import { runtimeContractTests } from "../harness/runtime-suite";
import { start, type Ctx } from "./support";

const REALISTIC = { clients: 33, policies: 80, coverages: 244, endorsements: 5, commissions: 15, tasks: 8, escalations: 0, escalation_events: 0 };
const CLEAN = { ...REALISTIC, clients: 31, coverages: 249 };

runtimeContractTests({
  service: "ams",
  port: 3000,
  rules: {
    process: "AMS-R120",
    database: "AMS-R121",
    seeding: "AMS-R122",
    status: "AMS-R123",
    chaos: "AMS-R124",
    trace: "AMS-R125",
  },
  start: async () => (await start()).svc,
  readPath: "/v1/clients",
  write: { path: "/v1/tasks", body: { title: "Recorded in the request log" } },
  seedCounts: { realistic: REALISTIC, clean: CLEAN },
});

// The seed files are a durable contract (specs/ams.spec.md, section 2), so the tests may read them.
function seedFile(folder: "seed" | "seed-clean", name: string): any[] {
  return JSON.parse(readFileSync(join(import.meta.dir, "..", "..", "..", "data", folder, `${name}.json`), "utf-8"));
}

describe("ams: mapping from seed files to rows", () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await start();
  }, 30_000);

  for (const [mode, folder] of [["realistic", "seed"], ["clean", "seed-clean"]] as const) {
    test(`AMS-R122, AMS-R114: the ${mode} data set is loaded row for row from data/${folder}`, async () => {
      await ctx.svc.reset(mode);
      const tables = await ctx.svc.snapshot();
      const byKey = (rows: any[], key: string) => [...rows].sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0));

      const clients = seedFile(folder, "clients");
      expect(tables.clients).toEqual(
        byKey(
          clients.map((c) => ({
            id: c.id,
            first_name: c.first_name,
            last_name: c.last_name,
            dob: c.dob ?? null,
            email: c.email,
            phone: c.phone ?? null,
            address_street: c.address?.street ?? null,
            address_city: c.address?.city ?? null,
            address_state: c.address?.state ?? null,
            address_zip: c.address?.zip ?? null,
            driver_license_number: c.driver_license_number ?? null,
            occupation: c.occupation ?? null,
            marital_status: c.marital_status ?? null,
            household_id: c.household_id ?? null,
            preferred_contact_method: c.preferred_contact_method ?? null,
            preferred_contact_time: c.preferred_contact_time ?? null,
            status: c.status,
            created_at: c.created_at,
            updated_at: c.updated_at,
          })),
          "id",
        ),
      );

      const policies = seedFile(folder, "policies");
      expect(tables.policies).toEqual(
        byKey(
          policies.map(({ coverages, ...p }) => ({
            policy_id: p.policy_id,
            client_id: p.client_id,
            carrier_code: p.carrier_code,
            policy_type: p.policy_type,
            effective_date: p.effective_date,
            expiration_date: p.expiration_date,
            premium_current: p.premium_current,
            premium_prior: p.premium_prior ?? null,
            status: p.status,
            multi_policy_discount: p.multi_policy_discount ?? false,
            created_at: p.created_at,
            updated_at: p.updated_at,
          })),
          "policy_id",
        ),
      );
      const coverages = policies.flatMap((p) =>
        p.coverages.map((cov: any) => ({
          policy_id: p.policy_id,
          type: cov.type,
          limit: cov.limit != null ? String(cov.limit) : null,
          deductible: cov.deductible ?? null,
        })),
      );
      expect(tables.coverages).toEqual(coverages.map((cov, i) => ({ id: i + 1, ...cov })));

      expect(tables.endorsements).toEqual(
        byKey(
          seedFile(folder, "endorsements").map((e) => ({
            endorsement_id: e.endorsement_id,
            policy_id: e.policy_id,
            effective_date: e.effective_date,
            change_type: e.change_type,
            changes: JSON.stringify(e.changes),
            premium_delta: e.premium_delta ?? null,
            status: e.status,
            notes: e.notes ?? null,
            created_at: e.created_at,
            updated_at: e.updated_at,
          })),
          "endorsement_id",
        ),
      );
      expect(tables.commissions).toEqual(
        byKey(
          seedFile(folder, "commissions").map((c) => ({
            commission_id: c.commission_id,
            policy_id: c.policy_id,
            carrier_code: c.carrier_code,
            transaction_type: c.transaction_type,
            gross_amount: c.gross_amount,
            net_amount: c.net_amount,
            commission_rate: c.commission_rate,
            effective_date: c.effective_date,
            payment_date: c.payment_date ?? null,
            status: c.status,
            producer_id: c.producer_id ?? null,
            created_at: c.created_at,
          })),
          "commission_id",
        ),
      );
      expect(tables.tasks).toEqual(
        byKey(
          seedFile(folder, "tasks").map((t) => ({
            id: t.id,
            title: t.title,
            description: t.description ?? null,
            status: t.status,
            priority: t.priority,
            task_type: null,
            assigned_to: t.assigned_to ?? null,
            related_client_id: t.related_client_id ?? null,
            related_policy_id: t.related_policy_id ?? null,
            due_date: t.due_date ?? null,
            created_at: t.created_at,
            updated_at: t.updated_at,
          })),
          "id",
        ),
      );
      expect(tables.escalations).toEqual([]);
      expect(tables.escalation_events).toEqual([]);
    });
  }
});

describe("ams: access log", () => {
  test.skipIf(expectedServiceMode("ams") !== "process")(
    "AMS-R120: the server writes one JSON line per request to standard output",
    async () => {
      const { svc, api } = await start();
      expect(svc.mode).toBe("process");
    await svc.seed();
    await api.get("/v1/clients/NO-SUCH-CLIENT", { headers: { "X-Correlation-ID": "access-log-1", "User-Agent": "conformance-test" } });
    await svc.http.get("/health", { headers: { "X-Correlation-ID": "access-log-2" } });

    let lines: any[] = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      lines = svc
        .logs()
        .split("\n")
        .flatMap((line) => {
          try {
            const parsed = JSON.parse(line);
            return typeof parsed?.correlation_id === "string" && parsed.correlation_id.startsWith("access-log-") ? [parsed] : [];
          } catch {
            return [];
          }
        });
      if (lines.length >= 2) break;
      await Bun.sleep(25);
    }
    expect(lines.map((l) => [l.correlation_id, l.method, l.path, l.status])).toEqual([
      ["access-log-1", "GET", "/v1/clients/NO-SUCH-CLIENT", 404],
      ["access-log-2", "GET", "/health", 200],
    ]);
    expect(lines[0].user_agent).toBe("conformance-test");
    for (const line of lines) {
      expect(Number.isNaN(Date.parse(line.timestamp))).toBe(false);
      expect(typeof line.duration_ms).toBe("number");
    }
    },
  );
});
