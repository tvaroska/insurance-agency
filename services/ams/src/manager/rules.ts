export interface ManagerRule {
  reason?: string;
  keywords?: string[];
  template_id: string;
}

export const RULES: ManagerRule[] = [
  // State minimum violations — always denied
  { reason: "state_minimum_violation", template_id: "state_minimum_override_denial" },

  // Backdating — always denied
  { reason: "backdating", template_id: "backdating_denial" },

  // Premium threshold — keyword scan determines approval vs denial
  { reason: "premium_threshold", keywords: ["deny", "decline", "reject", "unacceptable"], template_id: "premium_threshold_denial" },
  { reason: "premium_threshold", template_id: "premium_threshold_approval" },

  // Coverage adequacy
  { reason: "coverage_adequacy", keywords: ["gap", "lapse"], template_id: "coverage_gap_review" },
  { reason: "coverage_adequacy", keywords: ["roof", "inspection"], template_id: "roof_inspection_required" },
  { reason: "coverage_adequacy", template_id: "coverage_adequacy_review" },

  // Surplus lines
  { reason: "surplus_lines", keywords: ["no license", "missing license", "unlicensed"], template_id: "surplus_lines_license_missing" },
  { reason: "surplus_lines", template_id: "surplus_lines_approval" },

  // Principal review
  { reason: "principal_review", keywords: ["deny", "decline", "reject", "not acceptable"], template_id: "principal_approval_denied" },
  { reason: "principal_review", keywords: ["high value", "high-value"], template_id: "high_value_property_approval" },
  { reason: "principal_review", keywords: ["flood", "flood zone"], template_id: "flood_zone_exception" },
  { reason: "principal_review", keywords: ["attorney", "legal"], template_id: "attorney_referral_confirmation" },
  { reason: "principal_review", template_id: "principal_approval_granted" },

  // Fallback for any reason
  { template_id: "general_escalation_acknowledged" },
];
