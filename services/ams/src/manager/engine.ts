import { RULES } from "./rules";
import { TEMPLATES, type ManagerTemplate } from "./templates";

export interface EscalationInput {
  reason: string;
  summary: string;
  context?: Record<string, unknown> | null;
}

export interface ManagerDecision {
  decision: "approved" | "denied" | "needs_info";
  template_id: string;
  response_text: string;
}

export function processEscalation(input: EscalationInput): ManagerDecision {
  const summaryLower = input.summary.toLowerCase();

  for (const rule of RULES) {
    // If rule specifies a reason, it must match
    if (rule.reason && rule.reason !== input.reason) continue;

    // If rule specifies keywords, at least one must appear in the summary
    if (rule.keywords) {
      const matched = rule.keywords.some((kw) => summaryLower.includes(kw.toLowerCase()));
      if (!matched) continue;
    }

    const template = TEMPLATES[rule.template_id];
    if (!template) continue;

    return {
      decision: template.decision,
      template_id: template.template_id,
      response_text: template.response_text,
    };
  }

  // Should never reach here due to fallback rule, but just in case
  const fallback = TEMPLATES["general_escalation_acknowledged"];
  return {
    decision: fallback.decision,
    template_id: fallback.template_id,
    response_text: fallback.response_text,
  };
}
