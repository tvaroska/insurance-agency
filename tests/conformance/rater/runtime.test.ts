import { runtimeContractTests } from "../harness/runtime-suite";
import { start } from "./support";

runtimeContractTests({
  service: "rater",
  port: 3001,
  rules: {
    process: "RTR-R120",
    database: "RTR-R121",
    seeding: "RTR-R122",
    status: "RTR-R123",
    chaos: "RTR-R124",
    trace: "RTR-R125",
    accessLog: "RTR-R126",
  },
  start: async () => (await start()).svc,
  readPath: "/v1/carriers",
  write: { path: "/v1/quotes/request", body: { policy_type: "trace" } },
  seedCounts: {
    realistic: { quote_requests: 17, carrier_quotes: 54, carriers: 7 },
    clean: { quote_requests: 17, carrier_quotes: 54, carriers: 7 },
  },
});
