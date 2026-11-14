import { runtimeContractTests } from "../harness/runtime-suite";
import { start } from "./support";

runtimeContractTests({
  service: "ecm",
  port: 3003,
  rules: {
    process: "ECM-R120",
    database: "ECM-R121",
    seeding: "ECM-R122",
    status: "ECM-R123",
    chaos: "ECM-R124",
    trace: "ECM-R125",
    accessLog: "ECM-R126",
  },
  start: async () => (await start()).svc,
  readPath: "/v1/documents",
  write: { path: "/v1/envelopes/create", body: { client_id: "CLI-TRACE" } },
  seedCounts: {
    realistic: { documents: 87, envelopes: 10, marketing_assets: 8 },
    clean: { documents: 85, envelopes: 10, marketing_assets: 8 },
  },
});
