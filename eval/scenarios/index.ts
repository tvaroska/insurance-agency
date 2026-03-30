import type { ScenarioDefinition } from "../types";

import scenario01 from "./01-new-client-intake";
import scenario04 from "./04-duplicate-detection";
import scenario07 from "./07-fnol-claim";
import scenario08 from "./08-eo-trap-navigation";

export const scenarios: Record<string, ScenarioDefinition> = {
  "01": scenario01,
  "04": scenario04,
  "07": scenario07,
  "08": scenario08,
};
