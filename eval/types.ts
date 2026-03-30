// Scenario Definition Types

export type PromptDifficulty =
  | "scripted"
  | "explicit"
  | "natural"
  | "vague"
  | "adversarial";

export interface TestCase {
  id: string;
  prompt: string;
  difficulty: PromptDifficulty;
  outputChecks: OutputCheck[];
}

export interface ScenarioDefinition {
  id: string;
  name: string;
  difficulty: "easy" | "medium" | "hard";
  services: string[];

  variants: Record<string, VariantConfig>;
}

export interface VariantConfig {
  description: string;
  cases: TestCase[];
  expectedApiCalls: { min: number; max: number };

  traceChecks: TraceCheck[];
  eoTraps: EoTrap[];
}

export interface OutputCheck {
  name: string;
  weight: number;
  service: string;
  method: "GET";
  path: string;
  expect: {
    status: number;
    bodyMatch?: Record<string, unknown>;
    arrayMinLength?: number;
    arrayMaxLength?: number;
  };
}

export interface TraceCheck {
  name: string;
  weight: number;
  type: "sequence" | "presence" | "absence" | "count";

  pattern: {
    method?: string;
    pathPattern?: string;
    service?: string;
    statusCode?: number;
  };

  sequence?: { method: string; pathPattern: string }[];
  countRange?: { min: number; max: number };
}

export interface EoTrap {
  id: number;
  description: string;
  expectedAction: string;
  check: TraceCheck;
}

// API Call extracted from OTel spans

export interface ApiCall {
  method: string;
  url: string;
  path: string;
  service: string;
  statusCode: number;
  timestamp: number;
  durationMs: number;
}

// Port-to-service mapping

export const PORT_SERVICE_MAP: Record<number, string> = {
  3000: "ams",
  3001: "rater",
  3002: "crm",
  3003: "ecm",
  3004: "comm",
  3005: "summit-fire",
  3006: "coastal-star",
  3007: "claims",
};

// OTLP JSON types (subset needed for parsing)

export interface OtlpTrace {
  resourceSpans: ResourceSpan[];
}

export interface ResourceSpan {
  resource: {
    attributes: OtlpAttribute[];
  };
  scopeSpans: ScopeSpan[];
}

export interface ScopeSpan {
  spans: OtlpSpan[];
}

export interface OtlpSpan {
  traceId: string;
  spanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status?: { code: number };
}

export interface OtlpAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string | number;
    boolValue?: boolean;
  };
}

// Scoring result types

export interface OutputScore {
  name: string;
  passed: boolean;
  weight: number;
  detail?: string;
}

export interface TraceScore {
  name: string;
  passed: boolean;
  weight: number;
  detail?: string;
}

export interface EoTrapResult {
  id: number;
  description: string;
  caught: boolean;
}

// Report structure

export interface ScenarioReport {
  runId: string;
  timestamp: string;
  scenario: string;
  caseId: string;
  seed: "clean" | "realistic";
  overall: {
    score: number;
    eoCompliant: boolean;
    apiCalls: number;
    expectedRange: [number, number];
  };
  trace: {
    score: number;
    checks: TraceScore[];
  };
  output: {
    score: number;
    checks: OutputScore[];
  };
  eoTraps: EoTrapResult[];
}

// Scoring weights

export const DEFAULT_WEIGHTS = {
  trace: 0.4,
  output: 0.6,
} as const;

// Span kind constants (OTel convention)

export const SPAN_KIND_INTERNAL = 1;
export const SPAN_KIND_CLIENT = 3;

// Tool name → HTTP operation mapping (for GenAI trace parser fallback)

export interface ToolMapping {
  [operationId: string]: {
    method: string;
    path: string;
    service: string;
    baseUrl: string;
  };
}
