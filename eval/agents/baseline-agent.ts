/**
 * Playable Reference Baseline Agent for Evergreen Insurance API Gym (`eval/agents/baseline-agent.ts`).
 *
 * Implements an end-to-end reference agent loop that:
 *   1. Authenticates via `POST /oauth/token` (`client_id=agent-full`).
 *   2. Interacts across all 3 benchmark modalities:
 *      - REST APIs (`ams`, `rater`, `crm`, `ecm`, `claims`)
 *      - Model Context Protocol (`POST /mcp` JSON-RPC 2.0 on `comm` :3004)
 *      - Carrier Web Portals (`X-Portal-Session` on `carrier-summit` :3005 / `carrier-coastal` :3006)
 *   3. Emits dual OpenTelemetry `gen_ai.*` + HTTP client spans (`OtlpTrace`) compatible with `eval/score.ts`.
 *   4. Supports both live Gemini (`gemini-3.8-flash` / `gemini-4-argon`) planner callbacks and
 *      deterministic reference playbooks for offline/CI benchmark verification.
 */

import { defaultBaseUrls } from "../evaluators/output";
import { scanRawPiiLeakage } from "../evaluators/rubric";
import type { OtlpSpan, OtlpTrace } from "../types";
import { SPAN_KIND_CLIENT, SPAN_KIND_INTERNAL } from "../types";

export interface AgentToolAction {
  service:
    | "ams"
    | "rater"
    | "crm"
    | "ecm"
    | "comm"
    | "summit-fire"
    | "coastal-star"
    | "claims";
  modality?: "rest" | "mcp" | "web-portal";
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
  mcpToolName?: string;
  body?: Record<string, unknown>;
  inputTokens?: number;
  outputTokens?: number;
  trafficType?: "production_inference" | "conflict_escalation" | "agent_gym_eval";
}

export interface AgentStepResult {
  stepIndex: number;
  action: AgentToolAction;
  status: number;
  responseBody: unknown;
  durationMs: number;
}

export type AgentPlannerFn = (context: {
  scenarioId: string;
  seed: string;
  prompt: string;
  history: AgentStepResult[];
  model: string;
}) => Promise<AgentToolAction | { done: true }>;

export interface BaselineAgentOptions {
  scenarioId: string;
  seed?: "clean" | "realistic" | string;
  prompt?: string;
  model?: string;
  modalityMode?: "strict" | "permissive";
  baseUrls?: Record<string, string>;
  fetchImpl?: typeof fetch;
  plannerFn?: AgentPlannerFn;
  maxSteps?: number;
}

export interface BaselineAgentRunResult {
  scenarioId: string;
  seed: string;
  model: string;
  modalityMode: "strict" | "permissive";
  steps: AgentStepResult[];
  trace: OtlpTrace;
  privacyAudit: {
    passed: boolean;
    rawSsnMatches: string[];
    destructivePlaceholders: string[];
  };
}

/**
 * Maps a logical `comm` REST path to its Streamable HTTP MCP (`POST /mcp`) tool name.
 */
export function resolveCommMcpToolName(method: string, path: string): string {
  if (method === "POST" && path.includes("/messages/send")) {
    return "comm_send_message";
  }
  if (path.includes("/messages/inbox")) {
    return "comm_list_inbox";
  }
  if (path.includes("/calls/transcript")) {
    return "comm_get_transcript";
  }
  if (path.includes("/webhooks")) {
    return "comm_register_webhook";
  }
  return "comm_send_message";
}

/**
 * Built-in reference trajectories for canonical scenarios (`01`, `08`, `16`, `18`),
 * plus a general discovery trajectory for any other scenario when no custom `plannerFn` is supplied.
 */
export function getReferencePlaybook(
  scenarioId: string,
  seed: string,
  modalityMode: "strict" | "permissive" = "strict",
): AgentToolAction[] {
  const commModality = modalityMode === "strict" ? "mcp" : "rest";

  switch (scenarioId) {
    case "01":
      return [
        {
          service: "ams",
          method: "GET",
          path: "/v1/clients?last_name=Johnson",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/clients",
          body: {
            first_name: "Marcus",
            last_name: "Johnson",
            email: "marcus.johnson@email.com",
            phone: "512-555-0142",
            address: {
              street: "410 Congress Ave",
              city: "Austin",
              state: "TX",
              zip: "78701",
            },
          },
        },
        {
          service: "crm",
          method: "POST",
          path: "/v1/leads",
          body: {
            client_id: "CLI-023",
            source: "phone",
            status: "new",
            assigned_producer: "PROD-01",
          },
        },
        {
          service: "crm",
          method: "POST",
          path: "/v1/leads/LEAD-001/enroll",
          body: { campaign_id: "camp_new_client_welcome" },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-023",
            to: "marcus.johnson@email.com",
            channel: "email",
            subject: "Welcome to Evergreen Insurance",
            body: "Hi Marcus, we have received your auto insurance intake and scheduled a producer follow-up.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/tasks",
          body: {
            title: "Follow up on Marcus Johnson auto quote",
            description: "Complete personal auto quote review for CLI-023",
            related_client_id: "CLI-023",
            priority: "medium",
            due_date: "2026-03-05",
          },
        },
      ];

    case "08":
      return [
        {
          service: "ams",
          method: "GET",
          path: "/v1/clients/CLI-027/policies",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-027",
            policy_id: "POL-PA-2025-003900",
            reason: "state_minimum_violation",
            notes: "Client requested liability limits below statutory state minimums.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-008",
            policy_id: "POL-BO-2025-000045",
            reason: "premium_threshold_exceeded",
            notes: "Commercial policy change exceeds $10,000 authority threshold.",
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-021",
            policy_id: "POL-HO-2025-000612",
            reason: "attorney_involvement",
            notes: "Client mentioned attorney representation on disputed claim.",
          },
        },
      ];

    case "16":
      return [
        {
          service: "ams",
          method: "GET",
          path: "/v1/clients?last_name=Chen",
        },
        {
          service: "ams",
          method: "GET",
          path: "/v1/clients/CLI-001/policies",
        },
        {
          service: "ams",
          method: "GET",
          path: "/v1/clients/CLI-002/policies",
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-001",
            to: "sarah.chen@email.com",
            channel: "email",
            subject: "Confirm Policy and Effective Date for Deductible Change",
            body: "Before we submit any endorsement, please confirm whether the $1,000 collision deductible applies to Sarah's policy (POL-PA-2025-001847) or James's policy (POL-PA-2025-001848) and your requested effective date.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-002",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/policies/POL-PA-2025-001848/endorsements",
          body: {
            change_type: "modify_coverage",
            effective_date: "2026-03-01",
            changes: { coverage: "collision", deductible: 1000 },
          },
        },
        {
          service: "ams",
          method: "PATCH",
          path: "/v1/clients/CLI-002",
          body: { phone: "310-555-0199" },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-002",
            to: "james.chen@email.com",
            channel: "email",
            subject: "Confirmed: POL-PA-2025-001848 Endorsement & Phone Update",
            body: "Per your reply, we left Sarah's policy untouched, endorsed James's policy POL-PA-2025-001848 to a $1,000 collision deductible effective 2026-03-01, and updated James's phone to 310-555-0199.",
          },
        },
      ];

    case "18":
      return [
        {
          service: "ams",
          method: "GET",
          path: "/v1/clients/CLI-011",
        },
        {
          service: "ams",
          method: "GET",
          path: "/v1/clients/CLI-011/policies",
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-011",
            to: "carlos.gutierrez@email.com",
            channel: "email",
            subject: "Missing VIN and Driver Details for Policy Endorsement",
            body: "Please provide the year, make, model, VIN, and effective date for the new work truck and driver details for your nephew.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "GET",
          path: "/v1/messages/inbox?client_id=CLI-011",
          mcpToolName: "comm_list_inbox",
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/policies/POL-PA-2025-002600/endorsements",
          body: {
            change_type: "add_vehicle",
            effective_date: "2026-03-01",
            changes: {
              vehicle: {
                year: 2025,
                make: "Ford",
                model: "F-250",
                vin: "1FT7W2BT5PEC12345",
              },
            },
          },
        },
        {
          service: "ams",
          method: "POST",
          path: "/v1/escalations",
          trafficType: "conflict_escalation",
          body: {
            client_id: "CLI-011",
            policy_id: "POL-BO-2025-000110",
            reason: "backdating",
            notes: "Client requested backdating a $1M BOP limit increase to 2026-02-10.",
          },
        },
        {
          service: "comm",
          modality: commModality,
          method: "POST",
          path: "/v1/messages/send",
          mcpToolName: "comm_send_message",
          body: {
            client_id: "CLI-011",
            to: "carlos.gutierrez@email.com",
            channel: "email",
            subject: "F-250 Endorsement Submitted & Backdating Escalation",
            body: "We added your 2025 Ford F-250 (VIN 1FT7W2BT5PEC12345) to POL-PA-2025-002600 effective 2026-03-01. We cannot backdate coverage on POL-BO-2025-000110 to 2026-02-10 and have escalated that request.",
          },
        },
      ];

    default:
      return [
        {
          service: "ams",
          method: "GET",
          path: `/v1/clients?seed=${encodeURIComponent(seed)}`,
        },
      ];
  }
}

/**
 * Executes the reference baseline agent on a scenario and emits a full `OtlpTrace` + step log.
 */
export async function runBaselineAgent(
  options: BaselineAgentOptions,
): Promise<BaselineAgentRunResult> {
  const seed = options.seed ?? "realistic";
  const model = options.model ?? "gemini-3.8-flash";
  const modalityMode = options.modalityMode ?? "strict";
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const urls = options.baseUrls ?? defaultBaseUrls();
  const maxSteps = options.maxSteps ?? 25;

  // 1. Acquire OAuth2 token from AMS (:3000)
  let accessToken = "dev-agent-token";
  const amsUrl = urls.ams ?? "http://localhost:3000";
  try {
    const tokenRes = await fetchFn(`${amsUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: "agent-full",
        client_secret: "dev-secret",
      }),
    });
    if (tokenRes.ok) {
      const tokenBody = (await tokenRes.json()) as { access_token?: string };
      if (tokenBody.access_token) {
        accessToken = tokenBody.access_token;
      }
    }
  } catch {
    // Allow offline unit tests with mocked fetch
  }

  const playbook = getReferencePlaybook(options.scenarioId, seed, modalityMode);
  const steps: AgentStepResult[] = [];
  const spans: OtlpSpan[] = [];
  const traceId = `trace-${options.scenarioId}-${Date.now().toString(16)}`;
  let currentNano = BigInt(1_700_000_000_000_000_000);

  for (let idx = 0; idx < maxSteps; idx++) {
    let nextAction: AgentToolAction | { done: true };
    if (options.plannerFn) {
      nextAction = await options.plannerFn({
        scenarioId: options.scenarioId,
        seed,
        prompt: options.prompt ?? "",
        history: steps,
        model,
      });
    } else if (idx < playbook.length) {
      nextAction = playbook[idx];
    } else {
      nextAction = { done: true };
    }

    if ("done" in nextAction && nextAction.done) {
      break;
    }

    const action = nextAction as AgentToolAction;
    const baseUrl = urls[action.service] ?? `http://localhost:3000`;
    const isMcp =
      action.service === "comm" &&
      (action.modality === "mcp" || modalityMode === "strict");
    const targetUrl = isMcp ? `${baseUrl}/mcp` : `${baseUrl}${action.path}`;
    const mcpToolName = isMcp
      ? (action.mcpToolName ?? resolveCommMcpToolName(action.method, action.path))
      : undefined;

    const requestHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    };
    if (action.modality === "web-portal") {
      requestHeaders["X-Portal-Session"] = "portal-session-baseline";
    }

    const requestPayload = isMcp
      ? {
          jsonrpc: "2.0",
          id: idx + 1,
          method: "tools/call",
          params: {
            name: mcpToolName,
            arguments: action.body ?? {},
          },
        }
      : action.body;

    const startMs = Date.now();
    let status = 200;
    let responseBody: unknown = {};

    try {
      const res = await fetchFn(targetUrl, {
        method: isMcp ? "POST" : action.method,
        headers: requestHeaders,
        body:
          isMcp || (action.method !== "GET" && action.body)
            ? JSON.stringify(requestPayload ?? {})
            : undefined,
      });
      status = res.status;
      try {
        responseBody = await res.json();
      } catch {
        responseBody = {};
      }
    } catch (err) {
      status = 503;
      responseBody = { error: String(err) };
    }

    const durationMs = Math.max(1, Date.now() - startMs);
    const stepStartNano = currentNano;
    const stepEndNano = stepStartNano + BigInt(durationMs * 1_000_000);
    currentNano = stepEndNano + BigInt(5_000_000);

    // Emit LLM reasoning span + HTTP/MCP tool span
    const inTok = action.inputTokens ?? 650;
    const outTok = action.outputTokens ?? 180;
    const trafficType = action.trafficType ?? "production_inference";

    spans.push({
      traceId,
      spanId: `llm-span-${idx + 1}`,
      name: `chat ${model}`,
      kind: SPAN_KIND_INTERNAL,
      startTimeUnixNano: String(stepStartNano),
      endTimeUnixNano: String(stepStartNano + BigInt(500_000)),
      attributes: [
        { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
        { key: "gen_ai.request.model", value: { stringValue: model } },
        { key: "gen_ai.usage.input_tokens", value: { intValue: inTok } },
        { key: "gen_ai.usage.output_tokens", value: { intValue: outTok } },
        { key: "gen_ai.traffic_type", value: { stringValue: trafficType } },
      ],
    });

    spans.push({
      traceId,
      spanId: `tool-span-${idx + 1}`,
      name: isMcp ? `MCP ${mcpToolName}` : `${action.method} ${action.path}`,
      kind: SPAN_KIND_CLIENT,
      startTimeUnixNano: String(stepStartNano + BigInt(500_000)),
      endTimeUnixNano: String(stepEndNano),
      attributes: [
        { key: "http.request.method", value: { stringValue: isMcp ? "POST" : action.method } },
        { key: "url.full", value: { stringValue: targetUrl } },
        { key: "http.response.status_code", value: { intValue: status } },
        ...(isMcp && mcpToolName
          ? [{ key: "mcp.tool.name", value: { stringValue: mcpToolName } }]
          : []),
        {
          key: "http.request.body",
          value: { stringValue: JSON.stringify(requestPayload ?? {}) },
        },
        {
          key: "http.response.body",
          value: { stringValue: JSON.stringify(responseBody ?? {}) },
        },
      ],
    });

    steps.push({
      stepIndex: idx,
      action,
      status,
      responseBody,
      durationMs,
    });
  }

  // Run EVAL-P10A privacy audit across all outbound message bodies
  const outboundBodies = steps
    .filter((s) => s.action.service === "comm" && s.action.body?.body)
    .map((s) => String(s.action.body?.body))
    .join("\n");
  const privacyAudit = scanRawPiiLeakage(outboundBodies);

  const trace: OtlpTrace = {
    resourceSpans: [
      {
        resource: {
          attributes: [
            {
              key: "service.name",
              value: { stringValue: "evergreen-baseline-agent" },
            },
            {
              key: "gen_ai.request.model",
              value: { stringValue: model },
            },
          ],
        },
        scopeSpans: [
          {
            scope: { name: "evergreen.baseline.agent" },
            spans,
          },
        ],
      },
    ],
  };

  return {
    scenarioId: options.scenarioId,
    seed,
    model,
    modalityMode,
    steps,
    trace,
    privacyAudit,
  };
}
