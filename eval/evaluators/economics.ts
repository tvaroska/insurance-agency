/**
 * Cost, token efficiency, turn-budget & latency Pareto evaluator (S3-ECON-1 & S3-SIM-1).
 *
 * Parses OTLP traces for OpenTelemetry GenAI semantic conventions:
 * - `gen_ai.usage.input_tokens` / `gen_ai.usage.prompt_tokens`
 * - `gen_ai.usage.output_tokens` / `gen_ai.usage.completion_tokens`
 * - `gen_ai.request.model` / `gen_ai.response.model`
 * - `gen_ai.operation.name` ("chat", "generate_content", "invoke_agent", "execute_tool")
 * - Wall-clock duration, HTTP 4xx/5xx error counts, retry rates, and modality counts
 * - Interactive multi-turn count (`comm` outbound messages) & turn-budget efficiency
 * - Dollar cost and Score-per-Dollar Pareto efficiency
 */

import type {
  ApiCall,
  EconomicsMetrics,
  ModalityCounts,
  ModelPricing,
  OtlpAttribute,
  OtlpSpan,
  OtlpTrace,
  ToolMapping,
} from "../types";
import { parseTrace } from "./trace";

export type { EconomicsMetrics, ModalityCounts, ModelPricing };

// ── Model Pricing Table (USD per 1M tokens) ─────────────────────────

export const DEFAULT_MODEL_PRICING: ModelPricing = {
  input: 0.15,
  output: 0.6,
};

export const MODEL_PRICING_PER_1M: Record<string, ModelPricing> = {
  // Customer-facing Gemini models
  "gemini-3.8-flash": { input: 0.15, output: 0.6 },
  "gemini-4-argon": { input: 1.25, output: 5.0 },
  "gemini-4.0-pro": { input: 1.25, output: 5.0 },
  "gemini-3.5-flash-lite": { input: 0.075, output: 0.3 },
  // Standard Anthropic Claude models
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-3-7-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-5-sonnet": { input: 3.0, output: 15.0 },
  "claude-opus-4": { input: 15.0, output: 75.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "claude-3": { input: 3.0, output: 15.0 },
  // Standard OpenAI GPT / o-series models
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "o3-mini": { input: 1.1, output: 4.4 },
  "o1": { input: 15.0, output: 60.0 },
  // Fallback default
  default: DEFAULT_MODEL_PRICING,
};

/**
 * Strips provider path prefixes and internal release suffixes (`-qcd`, `-rc`, `-ga`, `-001`).
 */
export function normalizeModelName(model: string): string {
  const trimmed = model
    .trim()
    .toLowerCase()
    .replace(/^publishers\/[^/]+\/models\//, "")
    .replace(/^models\//, "");

  return trimmed.replace(/-(?:qcd|rc|ga|001|002|latest)(?:-\d+)?$/g, "");
}

/**
 * Resolves pricing (USD per 1M tokens) for a model identifier.
 */
export function resolveModelPricing(
  model?: string,
  pricingTable: Record<string, ModelPricing> = MODEL_PRICING_PER_1M,
): ModelPricing {
  if (!model) {
    return pricingTable.default ?? DEFAULT_MODEL_PRICING;
  }

  const normalized = normalizeModelName(model);
  if (pricingTable[normalized]) {
    return pricingTable[normalized];
  }
  if (pricingTable[model]) {
    return pricingTable[model];
  }

  // Prefix match fallback (e.g., "claude-3-5-sonnet-20241022" -> "claude-3-5-sonnet")
  for (const [key, rate] of Object.entries(pricingTable)) {
    if (key !== "default" && normalized.startsWith(key)) {
      return rate;
    }
  }

  return pricingTable.default ?? DEFAULT_MODEL_PRICING;
}

/**
 * Calculates estimated USD cost for a given model and token usage.
 */
export function calculateModelCost(
  model: string | undefined,
  inputTokens: number,
  outputTokens: number,
  pricingTable: Record<string, ModelPricing> = MODEL_PRICING_PER_1M,
): number {
  const rate = resolveModelPricing(model, pricingTable);
  const cost =
    (Math.max(0, inputTokens) / 1_000_000) * rate.input +
    (Math.max(0, outputTokens) / 1_000_000) * rate.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

// ── Turn-Budget & Pareto Scoring Helpers ────────────────────────────

/**
 * Computes multi-turn budget efficiency score (`1.0` if within budget, decayed if excessive).
 */
export function computeTurnBudgetScore(
  turnCount: number,
  maxTurns = 5,
  minTurns = 0,
): number {
  if (turnCount < 0) return 0;
  if (minTurns > 0 && turnCount < minTurns) {
    return Math.round((turnCount / minTurns) * 1000) / 1000;
  }
  if (turnCount <= maxTurns) {
    return 1.0;
  }
  const excessTurns = turnCount - maxTurns;
  // Smooth decay: each excess turn reduces budget score by 0.2 (floored at 0)
  return Math.max(0, Math.round((1 - excessTurns * 0.2) * 1000) / 1000);
}

/**
 * Computes Pareto efficiency (`score / Math.max(estimatedCostUsd, 0.0001)`).
 */
export function computeParetoEfficiency(
  score: number,
  estimatedCostUsd: number,
): number {
  const denom = Math.max(estimatedCostUsd, 0.0001);
  return Math.round((score / denom) * 100) / 100;
}

// ── OTLP Span Attribute Readers ─────────────────────────────────────

function getStringAttr(
  attrs: OtlpAttribute[] | undefined,
  key: string,
): string | undefined {
  if (!attrs) return undefined;
  const attr = attrs.find((a) => a.key === key);
  if (!attr) return undefined;
  if (attr.value.stringValue !== undefined) return attr.value.stringValue;
  return undefined;
}

function getNumberAttr(
  attrs: OtlpAttribute[] | undefined,
  key: string,
): number | undefined {
  if (!attrs) return undefined;
  const attr = attrs.find((a) => a.key === key);
  if (!attr) return undefined;
  if (typeof attr.value.intValue === "number") return attr.value.intValue;
  if (typeof attr.value.intValue === "string") {
    const parsed = parseInt(attr.value.intValue, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (typeof attr.value.doubleValue === "number") return attr.value.doubleValue;
  if (typeof attr.value.stringValue === "string") {
    const parsed = Number(attr.value.stringValue);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  return undefined;
}

const LLM_OPERATION_NAMES = new Set([
  "chat",
  "generate_content",
  "invoke_agent",
  "text_completion",
]);

function isLlmGenerationSpan(span: OtlpSpan): boolean {
  const opName = getStringAttr(span.attributes, "gen_ai.operation.name");
  if (opName && LLM_OPERATION_NAMES.has(opName)) {
    return true;
  }
  if (opName === "execute_tool") {
    return false;
  }
  const hasModel =
    getStringAttr(span.attributes, "gen_ai.request.model") !== undefined ||
    getStringAttr(span.attributes, "gen_ai.response.model") !== undefined;
  const hasTokens =
    getNumberAttr(span.attributes, "gen_ai.usage.input_tokens") !== undefined ||
    getNumberAttr(span.attributes, "gen_ai.usage.prompt_tokens") !== undefined ||
    getNumberAttr(span.attributes, "gen_ai.usage.output_tokens") !== undefined ||
    getNumberAttr(span.attributes, "gen_ai.usage.completion_tokens") !== undefined;
  return hasModel || hasTokens;
}

function isToolExecutionSpan(span: OtlpSpan): boolean {
  const opName = getStringAttr(span.attributes, "gen_ai.operation.name");
  return (
    opName === "execute_tool" ||
    getStringAttr(span.attributes, "gen_ai.tool.name") !== undefined
  );
}

function isOutboundCommToolSpan(span: OtlpSpan): boolean {
  const toolName = (
    getStringAttr(span.attributes, "gen_ai.tool.name") ??
    getStringAttr(span.attributes, "mcp.tool.name") ??
    ""
  ).toLowerCase();
  return (
    toolName === "comm:messages:send" ||
    toolName === "comm_messages_send" ||
    toolName === "comm_sendmessage" ||
    toolName === "comm_send_message" ||
    toolName === "messages_send" ||
    toolName === "sendmessage"
  );
}

// ── Main Economics Extractor ────────────────────────────────────────

export interface EconomicsOptions {
  score?: number;
  defaultModel?: string;
  pricingTable?: Record<string, ModelPricing>;
  maxTurns?: number;
  minTurns?: number;
  toolMapping?: ToolMapping;
}

/**
 * Extracts token usage, LLM/tool call counts, wall-clock duration, HTTP 4xx/5xx error
 * & retry rates, modality counts, multi-turn counts, and Pareto efficiency from an `OtlpTrace`.
 */
export function extractEconomicsMetrics(
  trace: OtlpTrace,
  apiCallsOrOptions?: ApiCall[] | EconomicsOptions,
  maybeOptions?: EconomicsOptions,
): EconomicsMetrics {
  const options: EconomicsOptions = Array.isArray(apiCallsOrOptions)
    ? (maybeOptions ?? {})
    : (apiCallsOrOptions ?? {});
  const apiCalls: ApiCall[] = Array.isArray(apiCallsOrOptions)
    ? apiCallsOrOptions
    : parseTrace(trace, options.toolMapping);

  const pricingTable = options.pricingTable ?? MODEL_PRICING_PER_1M;
  const defaultModel = options.defaultModel ?? "gemini-3.8-flash";
  const score = options.score ?? 1.0;
  const maxTurns = options.maxTurns ?? 5;
  const minTurns = options.minTurns ?? 0;

  let inputTokens = 0;
  let outputTokens = 0;
  let llmCalls = 0;
  let toolSpanCount = 0;
  let rawCostUsd = 0;

  let minStartNano: bigint | null = null;
  let maxEndNano: bigint | null = null;

  const modelsUsedSet = new Set<string>();
  let mcpSpanCount = 0;
  let uiSpanCount = 0;
  let commToolSendCount = 0;
  let explicitRetryCount = 0;

  for (const rs of trace.resourceSpans ?? []) {
    for (const ss of rs.scopeSpans ?? []) {
      for (const span of ss.spans ?? []) {
        // Track wall-clock window
        try {
          if (span.startTimeUnixNano) {
            const sNano = BigInt(span.startTimeUnixNano);
            if (minStartNano === null || sNano < minStartNano) {
              minStartNano = sNano;
            }
          }
          if (span.endTimeUnixNano) {
            const eNano = BigInt(span.endTimeUnixNano);
            if (maxEndNano === null || eNano > maxEndNano) {
              maxEndNano = eNano;
            }
          }
        } catch {
          // Ignore malformed nano strings
        }

        const spanIn =
          getNumberAttr(span.attributes, "gen_ai.usage.input_tokens") ??
          getNumberAttr(span.attributes, "gen_ai.usage.prompt_tokens") ??
          0;
        const spanOut =
          getNumberAttr(span.attributes, "gen_ai.usage.output_tokens") ??
          getNumberAttr(span.attributes, "gen_ai.usage.completion_tokens") ??
          0;

        const rawModel =
          getStringAttr(span.attributes, "gen_ai.response.model") ??
          getStringAttr(span.attributes, "gen_ai.request.model");

        if (rawModel) {
          modelsUsedSet.add(normalizeModelName(rawModel));
        }

        if (isLlmGenerationSpan(span)) {
          llmCalls++;
        }

        if (spanIn > 0 || spanOut > 0) {
          inputTokens += spanIn;
          outputTokens += spanOut;
          const modelForSpan = rawModel ?? defaultModel;
          const rate = resolveModelPricing(modelForSpan, pricingTable);
          rawCostUsd +=
            (spanIn / 1_000_000) * rate.input +
            (spanOut / 1_000_000) * rate.output;
        }

        if (isToolExecutionSpan(span)) {
          toolSpanCount++;
          const toolName =
            getStringAttr(span.attributes, "gen_ai.tool.name") ?? "";
          if (
            toolName.startsWith("comm:") ||
            getStringAttr(span.attributes, "rpc.system") === "mcp" ||
            getStringAttr(span.attributes, "mcp.tool.name") !== undefined
          ) {
            mcpSpanCount++;
          }
          if (
            toolName.startsWith("browser_") ||
            toolName.startsWith("playwright_") ||
            toolName.startsWith("portal_")
          ) {
            uiSpanCount++;
          }
          if (isOutboundCommToolSpan(span)) {
            commToolSendCount++;
          }
        }

        const resend =
          getNumberAttr(span.attributes, "http.resend_count") ??
          getNumberAttr(span.attributes, "gen_ai.retry_count") ??
          0;
        if (resend > 0) {
          explicitRetryCount += resend;
        }
      }
    }
  }

  const totalTokens = inputTokens + outputTokens;
  const wallClockMs =
    minStartNano !== null && maxEndNano !== null && maxEndNano >= minStartNano
      ? Number((maxEndNano - minStartNano) / 1_000_000n)
      : 0;

  // Tool calls: max of explicit execute_tool spans or parsed HTTP API calls
  const toolCalls = Math.max(toolSpanCount, apiCalls.length);

  // Error & retry analysis across API calls
  let errorCount4xx = 0;
  let errorCount5xx = 0;
  let retryCallsAfterFailure = 0;
  const failedEndpoints = new Set<string>();

  let mcpHttpCount = 0;
  let uiHttpCount = 0;
  let restHttpCount = 0;
  let commHttpSendCount = 0;

  for (const call of apiCalls) {
    if (call.statusCode >= 400 && call.statusCode < 500) {
      errorCount4xx++;
    } else if (call.statusCode >= 500 && call.statusCode < 600) {
      errorCount5xx++;
    }

    const endpointKey = `${call.method}:${call.service}:${call.path}`;
    if (failedEndpoints.has(endpointKey)) {
      retryCallsAfterFailure++;
    }
    if (call.statusCode >= 400) {
      failedEndpoints.add(endpointKey);
    }

    // Modality classification
    if (call.path.startsWith("/mcp")) {
      mcpHttpCount++;
    } else if (
      (call.service === "summit-fire" || call.service === "coastal-star") &&
      (call.path.startsWith("/portal") || call.path.startsWith("/auth/portal-session"))
    ) {
      uiHttpCount++;
    } else {
      restHttpCount++;
    }

    // Outbound Comm Hub messages (interactive turns)
    if (
      call.service === "comm" &&
      call.method === "POST" &&
      (call.path.includes("/messages/send") ||
        call.path.endsWith("/messages") ||
        call.path.startsWith("/mcp"))
    ) {
      commHttpSendCount++;
    }
  }

  const totalRetries = Math.max(explicitRetryCount, retryCallsAfterFailure);
  const retryDenominator = Math.max(apiCalls.length, toolCalls, 1);
  const retryRate =
    Math.round((totalRetries / retryDenominator) * 10000) / 10000;

  const estimatedCostUsd = Math.round(rawCostUsd * 1_000_000) / 1_000_000;
  const turnCount = Math.max(commHttpSendCount, commToolSendCount);
  const turnBudgetScore = computeTurnBudgetScore(turnCount, maxTurns, minTurns);
  const paretoEfficiency = computeParetoEfficiency(score, estimatedCostUsd);

  const modalityCounts: ModalityCounts = {
    mcp: Math.max(mcpSpanCount, mcpHttpCount),
    rest: restHttpCount,
    ui: Math.max(uiSpanCount, uiHttpCount),
  };

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    llmCalls,
    toolCalls,
    wallClockMs,
    durationMs: wallClockMs,
    errorCount4xx,
    errorCount5xx,
    retryRate,
    estimatedCostUsd,
    costUsd: estimatedCostUsd,
    turnCount,
    turnBudgetScore,
    paretoEfficiency,
    modelsUsed: Array.from(modelsUsedSet),
    modalityCounts,
  };
}
