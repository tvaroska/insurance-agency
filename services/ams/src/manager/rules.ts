export interface ManagerRule {
  reason?: string;
  // Structured context predicate only — never inspect free-text summary wording.
  when?: (context: Record<string, unknown> | null) => boolean;
  template_id: string;
}

function isExplicitDenial(ctx: Record<string, unknown> | null): boolean {
  if (!ctx) return false;
  return (
    ctx.risk_acceptable === false ||
    ctx.underwriting_eligible === false ||
    ctx.within_appetite === false ||
    ctx.decision === "denied" ||
    ctx.decision === "deny"
  );
}

export const RULES: ManagerRule[] = [
  // State minimum violations — always denied
  { reason: "state_minimum_violation", template_id: "state_minimum_override_denial" },

  // Backdating — always denied
  { reason: "backdating", template_id: "backdating_denial" },

  // Premium threshold — structured context determines denial vs approval
  {
    reason: "premium_threshold",
    when: isExplicitDenial,
    template_id: "premium_threshold_denial",
  },
  { reason: "premium_threshold", template_id: "premium_threshold_approval" },

  // Coverage adequacy
  {
    reason: "coverage_adequacy",
    when: (ctx) =>
      ctx?.has_coverage_gap === true ||
      ctx?.coverage_gap === true ||
      ctx?.issue === "coverage_gap" ||
      ctx?.issue === "lapse",
    template_id: "coverage_gap_review",
  },
  {
    reason: "coverage_adequacy",
    when: (ctx) =>
      ctx?.roof_inspection_required === true ||
      ctx?.issue === "roof_inspection" ||
      (typeof ctx?.roof_age_years === "number" && ctx.roof_age_years > 15),
    template_id: "roof_inspection_required",
  },
  { reason: "coverage_adequacy", template_id: "coverage_adequacy_review" },

  // Surplus lines
  {
    reason: "surplus_lines",
    when: (ctx) =>
      ctx?.surplus_lines_licensed === false ||
      ctx?.has_surplus_lines_license === false ||
      ctx?.license_on_file === false,
    template_id: "surplus_lines_license_missing",
  },
  { reason: "surplus_lines", template_id: "surplus_lines_approval" },

  // Attorney involvement — always confirmed for legal referral
  { reason: "attorney_involvement", template_id: "attorney_referral_confirmation" },

  // Principal review
  {
    reason: "principal_review",
    when: isExplicitDenial,
    template_id: "principal_approval_denied",
  },
  {
    reason: "principal_review",
    when: (ctx) =>
      ctx?.high_value_property === true || ctx?.category === "high_value_property",
    template_id: "high_value_property_approval",
  },
  {
    reason: "principal_review",
    when: (ctx) => ctx?.flood_zone === true || ctx?.category === "flood_zone",
    template_id: "flood_zone_exception",
  },
  {
    reason: "principal_review",
    when: (ctx) =>
      ctx?.attorney_involved === true || ctx?.category === "attorney_involvement",
    template_id: "attorney_referral_confirmation",
  },
  { reason: "principal_review", template_id: "principal_approval_granted" },

  // Fallback for any reason
  { template_id: "general_escalation_acknowledged" },
];
