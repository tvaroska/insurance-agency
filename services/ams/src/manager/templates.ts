export interface ManagerTemplate {
  template_id: string;
  decision: "approved" | "denied" | "needs_info";
  response_text: string;
}

export const TEMPLATES: Record<string, ManagerTemplate> = {
  coverage_adequacy_review: {
    template_id: "coverage_adequacy_review",
    decision: "needs_info",
    response_text:
      "Please provide the current coverage declarations page and any prior loss history before I can evaluate adequacy.",
  },
  roof_inspection_required: {
    template_id: "roof_inspection_required",
    decision: "needs_info",
    response_text:
      "A roof inspection report is required for properties with roofs older than 15 years. Please obtain and submit before proceeding.",
  },
  coverage_gap_review: {
    template_id: "coverage_gap_review",
    decision: "needs_info",
    response_text:
      "I need to review the gap in coverage dates. Please provide documentation of prior coverage or a signed statement of no loss.",
  },
  high_value_property_approval: {
    template_id: "high_value_property_approval",
    decision: "approved",
    response_text:
      "High-value property binding approved. Ensure appraisal is on file and replacement cost endorsement is attached.",
  },
  premium_threshold_approval: {
    template_id: "premium_threshold_approval",
    decision: "approved",
    response_text:
      "Premium threshold review complete. Approved for binding. Verify payment plan is documented.",
  },
  flood_zone_exception: {
    template_id: "flood_zone_exception",
    decision: "approved",
    response_text:
      "Flood zone exception granted. Ensure separate flood policy is in place or NFIP documentation is attached.",
  },
  surplus_lines_approval: {
    template_id: "surplus_lines_approval",
    decision: "approved",
    response_text:
      "Surplus lines placement approved. Verify surplus lines license is current and proper disclosures are provided to insured.",
  },
  principal_approval_granted: {
    template_id: "principal_approval_granted",
    decision: "approved",
    response_text:
      "Principal review complete. This risk has been approved for binding. Proceed with standard procedures.",
  },
  attorney_referral_confirmation: {
    template_id: "attorney_referral_confirmation",
    decision: "approved",
    response_text:
      "Attorney referral confirmed. Proceed with the recommended legal counsel and document all communications.",
  },
  state_minimum_override_denial: {
    template_id: "state_minimum_override_denial",
    decision: "denied",
    response_text:
      "Cannot override state minimum coverage requirements. The requested limits fall below the mandatory minimums for this state. Adjust coverages to meet or exceed state requirements.",
  },
  premium_threshold_denial: {
    template_id: "premium_threshold_denial",
    decision: "denied",
    response_text:
      "Premium threshold review denied. The risk profile does not meet underwriting guidelines at this premium level.",
  },
  surplus_lines_license_missing: {
    template_id: "surplus_lines_license_missing",
    decision: "denied",
    response_text:
      "Cannot place this risk on surplus lines — the required surplus lines license is not on file. Obtain proper licensing before resubmitting.",
  },
  principal_approval_denied: {
    template_id: "principal_approval_denied",
    decision: "denied",
    response_text:
      "Principal review complete. This risk does not meet our agency's risk appetite and has been declined.",
  },
  backdating_denial: {
    template_id: "backdating_denial",
    decision: "denied",
    response_text:
      "Backdating coverage is not permitted. The effective date must be the current date or a future date.",
  },
  general_escalation_acknowledged: {
    template_id: "general_escalation_acknowledged",
    decision: "needs_info",
    response_text:
      "Escalation received and under review. Please provide any additional context or documentation that may help expedite the decision.",
  },
};
