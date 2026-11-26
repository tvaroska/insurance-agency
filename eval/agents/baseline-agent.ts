/**
 * Reference Baseline Agent runner for Evergreen Insurance API Gym (`eval/agents/baseline-agent.ts`).
 */

import { defaultBaseUrls } from "../evaluators/output";
import { scanRawPiiLeakage } from "../evaluators/rubric";
import type { OtlpSpan, OtlpTrace } from "../types";
import { SPAN_KIND_CLIENT, SPAN_KIND_INTERNAL } from "../types";
import { getComplianceAndAuditPlaybook } from "./playbooks-compliance-and-audit";
import { getServicingAndMultiturnPlaybook } from "./playbooks-servicing-and-multiturn";
import { getSingleTurnPlaybook } from "./playbooks-single-turn";

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
  actions?: AgentToolAction[];
  maxSteps?: number;
  tokenProfile?: "general_agent" | "domain_skill" | "compiled_code";
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

export function getReferencePlaybook(
  scenarioId: string,
  seed: string,
  modalityMode: "strict" | "permissive" = "strict",
): AgentToolAction[] {
  const commModality = modalityMode === "strict" ? "mcp" : "rest";
  const portalModality = modalityMode === "strict" ? "web-portal" : "rest";
  return (
    getSingleTurnPlaybook(scenarioId, seed, commModality, portalModality) ??
    getComplianceAndAuditPlaybook(scenarioId, seed, commModality, portalModality) ??
    getServicingAndMultiturnPlaybook(scenarioId, seed, commModality, portalModality) ?? [
      {
        service: "ams",
        method: "GET",
        path: `/v1/clients?seed=${encodeURIComponent(seed)}`,
      },
    ]
  );
}

function resolvePlaybookPlaceholders(
  action: AgentToolAction,
  ids: Record<string, string>,
): AgentToolAction {
  const sub = (s: string) =>
    s.replace(/\{([a-z_]+)\}/g, (m, key: string) => ids[key] ?? m);
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return sub(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, walk(val)]),
      );
    }
    return v;
  };
  return {
    ...action,
    path: sub(action.path),
    ...(action.body !== undefined
      ? { body: walk(action.body) as AgentToolAction["body"] }
      : {}),
  };
}

export async function runBaselineAgent(
  options: BaselineAgentOptions,
): Promise<BaselineAgentRunResult> {
  const seed = options.seed ?? "realistic";
  const model = options.model ?? "gemini-3.8-flash";
  const modalityMode = options.modalityMode ?? "strict";
  const tokenProfile = options.tokenProfile ?? "general_agent";
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const urls = options.baseUrls ?? defaultBaseUrls();
  const maxSteps = options.maxSteps ?? 45;

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
    // Offline unit tests may mock fetch without /oauth/token.
  }

  const playbook = options.actions ?? getReferencePlaybook(options.scenarioId, seed, modalityMode);

  // Strict mode accepts only portal sessions issued by the carrier after page boot.
  const portalSessions = new Map<string, string>();
  const portalSessionFor = async (baseUrl: string): Promise<string | undefined> => {
    const cached = portalSessions.get(baseUrl);
    if (cached) return cached;
    try {
      let cookieHeader: string | undefined;
      try {
        const bootRes = await fetchFn(`${baseUrl}/`);
        const rawCookies: string[] =
          typeof bootRes.headers?.getSetCookie === "function"
            ? bootRes.headers.getSetCookie()
            : bootRes.headers?.get("set-cookie")
              ? [bootRes.headers.get("set-cookie")!]
              : [];
        const bootPairs: string[] = [];
        for (const raw of rawCookies) {
          const matches = raw.match(/evergreen_portal_boot_[^=;\s]+=[^;\s,]+/g);
          if (matches) bootPairs.push(...matches);
        }
        if (bootPairs.length > 0) {
          cookieHeader = bootPairs.join("; ");
        }
      } catch {
        // Offline unit tests may not serve GET /.
      }
      const res = await fetchFn(
        `${baseUrl}/auth/portal-session`,
        cookieHeader ? { headers: { Cookie: cookieHeader } } : undefined,
      );
      const body = res.ok ? ((await res.json()) as { session_token?: string }) : {};
      if (body.session_token) portalSessions.set(baseUrl, body.session_token);
      return body.session_token;
    } catch {
      return undefined;
    }
  };

  const steps: AgentStepResult[] = [];
  const spans: OtlpSpan[] = [];
  const capturedIds: Record<string, string> = {
    created_claim_id: "CLM-2026-000013",
  };
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

    const action = resolvePlaybookPlaceholders(
      nextAction as AgentToolAction,
      capturedIds,
    );
    const baseUrl = urls[action.service] ?? "http://localhost:3000";
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
    if (isMcp) {
      requestHeaders["Accept"] = "application/json, text/event-stream";
    }
    if (
      action.modality === "web-portal" ||
      action.service === "summit-fire" ||
      action.service === "coastal-star"
    ) {
      const portalSession = await portalSessionFor(baseUrl);
      if (portalSession) requestHeaders["X-Portal-Session"] = portalSession;
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

    if (
      action.service === "claims" &&
      action.method === "POST" &&
      action.path === "/v1/claims" &&
      status >= 200 &&
      status < 300
    ) {
      const rb = responseBody as { claim_id?: unknown; data?: { claim_id?: unknown } };
      const newClaimId = rb?.claim_id ?? rb?.data?.claim_id;
      if (typeof newClaimId === "string" && newClaimId.length > 0) {
        capturedIds.created_claim_id = newClaimId;
      }
    }

    const durationMs = Math.max(1, Date.now() - startMs);
    const stepStartNano = currentNano;
    const stepEndNano = stepStartNano + BigInt(durationMs * 1_000_000);
    currentNano = stepEndNano + BigInt(5_000_000);

    const defaultInTok =
      tokenProfile === "compiled_code"
        ? 0
        : tokenProfile === "domain_skill"
          ? 240
          : 650;
    const defaultOutTok =
      tokenProfile === "compiled_code"
        ? 0
        : tokenProfile === "domain_skill"
          ? 75
          : 180;
    const inTok = action.inputTokens ?? defaultInTok;
    const outTok = action.outputTokens ?? defaultOutTok;
    const trafficType = action.trafficType ?? "production_inference";

    if (inTok > 0 || outTok > 0) {
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
          { key: "gen_ai.usage.outputTokens", value: { intValue: outTok } },
          { key: "gen_ai.usage.output_tokens", value: { intValue: outTok } },
          { key: "gen_ai.traffic_type", value: { stringValue: trafficType } },
        ],
      });
    }

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
