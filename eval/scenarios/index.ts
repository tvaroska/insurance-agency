import type { ScenarioDefinition } from "../types";

import scenario01 from "./01-new-client-intake";
import scenario02 from "./02-multi-carrier-quote-comparison";
import scenario03 from "./03-policy-binding-e2e";
import scenario04 from "./04-duplicate-detection";
import scenario05 from "./05-renewal-reshop";
import scenario06 from "./06-cross-sell-detection";
import scenario07 from "./07-fnol-claim";
import scenario08 from "./08-eo-trap-navigation";
import scenario09 from "./09-carrier-denial-recovery";
import scenario10 from "./10-book-of-business-audit";
import scenario11 from "./11-client-meeting-prep";
import scenario12 from "./12-policy-status-inquiry";
import scenario13 from "./13-certificate-of-insurance";
import scenario14 from "./14-lead-qualification";
import scenario15 from "./15-commission-reconciliation";

export const scenarios: Record<string, ScenarioDefinition> = {
  "01": scenario01,
  "02": scenario02,
  "03": scenario03,
  "04": scenario04,
  "05": scenario05,
  "06": scenario06,
  "07": scenario07,
  "08": scenario08,
  "09": scenario09,
  "10": scenario10,
  "11": scenario11,
  "12": scenario12,
  "13": scenario13,
  "14": scenario14,
  "15": scenario15,
};
