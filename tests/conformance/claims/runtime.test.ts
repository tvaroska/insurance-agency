import { runtimeContractTests } from "../harness/runtime-suite";
import { start } from "./support";

runtimeContractTests({
  service: "claims",
  port: 3007,
  rules: {
    process: "CLM-R120",
    database: "CLM-R121",
    seeding: "CLM-R122",
    status: "CLM-R123",
    chaos: "CLM-R124",
    trace: "CLM-R125",
    accessLog: "CLM-R126",
  },
  start: async () => (await start()).svc,
  readPath: "/v1/claims",
  write: { path: "/v1/claims", body: { policy_id: "POL-TRACE" } },
  seedCounts: {
    realistic: { adjusters: 3, claims: 14, claim_documents: 0, claim_timeline: 0, "claims[status=denied]": 1 },
    clean: { adjusters: 3, claims: 14, claim_documents: 0, claim_timeline: 0, "claims[status=denied]": 0 },
  },
});
