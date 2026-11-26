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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function processEscalation(input: EscalationInput): ManagerDecision {
  const context = isRecord(input.context) ? input.context : null;

  for (const rule of RULES) {
    if (rule.reason && rule.reason !== input.reason) continue;
    if (rule.when && !rule.when(context)) continue;

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
