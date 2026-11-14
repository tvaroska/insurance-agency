import { runtimeContractTests } from "../harness/runtime-suite";
import { start } from "./support";

runtimeContractTests({
  service: "crm",
  port: 3002,
  rules: {
    process: "CRM-R120",
    database: "CRM-R121",
    seeding: "CRM-R122",
    status: "CRM-R123",
    chaos: "CRM-R124",
    trace: "CRM-R125",
    accessLog: "CRM-R126",
  },
  start: async () => (await start()).svc,
  readPath: "/v1/leads",
  write: { path: "/v1/leads", body: { first_name: "Trace" } },
  seedCounts: {
    realistic: { leads: 16, campaigns: 5, campaign_enrollments: 0, retention_risks: 12 },
    clean: { leads: 14, campaigns: 5, campaign_enrollments: 0, retention_risks: 10 },
  },
});
