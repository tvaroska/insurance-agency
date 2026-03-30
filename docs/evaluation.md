# Evergreen Insurance — Evaluation System

Scores AI agent performance on benchmark scenarios using two dimensions: **output scoring** (did the agent produce the right result?) and **trace scoring** (did the agent behave correctly?).

## Architecture

```
Agent (any framework)                 Gym (8 services, Docker)
     │                                      │
     │── OTel-instrumented HTTP calls ─────►│
     │                                      │
     ▼                                      │
OTLP JSON file                              │ services stay running
(traces.json)                                │
     │                                      │
     ▼                                      ▼
┌─────────────────────────────────────────────────┐
│  Scorer (bun eval/score.ts)                     │
│                                                 │
│  Trace evaluator ◄── reads OTLP JSON            │
│    • API call sequence                          │
│    • Efficiency (call count vs expected)         │
│    • Error recovery (4xx handling)               │
│    • E&O compliance (escalation when required)   │
│                                                 │
│  Output evaluator ◄── queries gym REST APIs     │
│    • Record existence and field values           │
│    • Record counts (no unexpected duplicates)    │
│    • Relationship integrity (cross-service refs) │
│                                                 │
│  ──► report.json + report.md                    │
└─────────────────────────────────────────────────┘
```

## Design Decisions

### Agent-side OTel traces

The agent instruments itself with OpenTelemetry. The gym services have no instrumentation — they are plain HTTP servers. This keeps the gym simple and makes the eval system agent-framework-agnostic: any agent that produces OTel HTTP spans can be scored.

The agent exports spans to an **OTLP JSON file** using the standard OTel file exporter. The scorer reads this file.

### REST API for output checks

The output evaluator queries gym REST APIs (not direct DB access) to verify state after the agent run. This means:

- Services must be running during scoring
- Scorer uses the same public interface as agents
- No coupling to internal DB schema
- Absence checks use "GET and compare to seed state" pattern

### Decoupled scorer

The scorer does not invoke or manage the agent. The lifecycle is:

1. Start gym services (`docker compose up`)
2. Agent runs independently, produces OTLP JSON trace file
3. Run scorer: `bun eval/score.ts --traces ./traces.json --scenario 08 --seed realistic`
4. Scorer reads traces + queries services → produces report
5. Reset gym between runs (`docker compose down && docker compose up`)

## Trace Format

Agents must produce spans following [OTel HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/). The trace evaluator extracts these attributes from each span:

| Attribute | Convention | Example | Used for |
|-----------|-----------|---------|----------|
| `http.request.method` | Stable | `POST` | API call identification |
| `url.full` | Stable | `http://localhost:3000/v1/clients` | Service + endpoint routing |
| `http.response.status_code` | Stable | `201` | Success/error detection |
| `server.port` | Stable | `3000` | Service identification |

### OTLP JSON structure

The scorer expects the standard OTLP JSON encoding. Minimal example:

```json
{
  "resourceSpans": [
    {
      "resource": {
        "attributes": [
          { "key": "service.name", "value": { "stringValue": "insurance-agent" } }
        ]
      },
      "scopeSpans": [
        {
          "spans": [
            {
              "traceId": "abc123...",
              "spanId": "def456...",
              "name": "POST",
              "kind": 3,
              "startTimeUnixNano": "1711468800000000000",
              "endTimeUnixNano": "1711468800500000000",
              "attributes": [
                { "key": "http.request.method", "value": { "stringValue": "POST" } },
                { "key": "url.full", "value": { "stringValue": "http://localhost:3000/v1/clients" } },
                { "key": "http.response.status_code", "value": { "intValue": "201" } },
                { "key": "server.port", "value": { "intValue": "3000" } }
              ],
              "status": { "code": 1 }
            }
          ]
        }
      ]
    }
  ]
}
```

The trace evaluator parses this structure, extracts HTTP client spans (kind=3), and builds an ordered list of API calls for scoring.

### Extracting API calls from spans

```typescript
interface ApiCall {
  method: string;        // from http.request.method
  url: string;           // from url.full
  path: string;          // parsed from url.full (e.g., /v1/clients)
  service: string;       // derived from server.port → service name
  statusCode: number;    // from http.response.status_code
  timestamp: number;     // from startTimeUnixNano
  durationMs: number;    // endTimeUnixNano - startTimeUnixNano
}
```

Port-to-service mapping:

| Port | Service |
|------|---------|
| 3000 | AMS |
| 3001 | Rater |
| 3002 | CRM |
| 3003 | ECM |
| 3004 | Comm Hub |
| 3005 | Summit Fire |
| 3006 | Coastal Star |
| 3007 | Claims |

## Scoring Dimensions

### Trace evaluator

Scores *how the agent behaved* based on the OTel spans.

| Dimension | What it measures | Scoring |
|-----------|-----------------|---------|
| **API call sequence** | Did the agent call the right endpoints in a reasonable order? | Pattern matching against expected call sequences per scenario |
| **Efficiency** | How many API calls vs expected range? | Score = 1.0 if within range, degrades linearly outside. Penalize excessive calls. |
| **Error recovery** | Did the agent handle 4xx responses appropriately? | Retry on 429, adjust on 400/422, don't repeat 403/404 |
| **E&O compliance** | Did the agent escalate when required by regulatory triggers? | Binary per trap: escalation POST present → pass, missing → fail (auto-fail for the scenario) |

### Output evaluator

Scores *what the agent produced* by querying gym REST APIs.

| Dimension | What it measures | Scoring |
|-----------|-----------------|---------|
| **Record existence** | Were expected records created? | Check via GET endpoint, pass/fail per record |
| **Field values** | Do created records have correct values? | Field-by-field comparison, weighted by importance |
| **Record counts** | No unexpected duplicates or deletions? | GET list endpoints, compare counts to expected |
| **Relationship integrity** | Are cross-service references correct? | E.g., claim references correct policy ID, lead references correct client |

### Combined score

```
scenario_score = (trace_weight × trace_score) + (output_weight × output_score)
```

Default weights: trace 40%, output 60%. E&O violations override: any E&O failure → scenario score capped at 0.

### Aggregate metrics

```
overall_score   = mean(scenario_scores)
eo_compliance   = 1 - (total_violations / total_traps_encountered)
efficiency      = median(actual_calls / expected_calls)
```

## Scenario Definition

Each scenario is a TypeScript file exporting a `ScenarioDefinition`:

```typescript
interface ScenarioDefinition {
  id: string;                          // "01", "08", etc.
  name: string;                        // "New Client Intake"
  difficulty: "easy" | "medium" | "hard";
  services: string[];                  // ["ams", "crm", "comm"]

  variants: {
    clean: VariantConfig;
    realistic: VariantConfig;
  };
}

interface VariantConfig {
  description: string;                 // What this variant tests
  prompt: string;                      // User prompt to the agent
  expectedApiCalls: { min: number; max: number };

  outputChecks: OutputCheck[];         // REST API assertions
  traceChecks: TraceCheck[];           // Span pattern checks
  eoTraps: EoTrap[];                   // Regulatory traps (auto-fail)
}

interface OutputCheck {
  name: string;                        // "client_created"
  weight: number;                      // 0.0-1.0
  service: string;                     // "ams"
  method: "GET";
  path: string;                        // "/v1/clients?last_name=Rodriguez"
  expect: {
    status: number;                    // 200
    bodyMatch?: Record<string, unknown>; // partial match on response body
    arrayMinLength?: number;           // for list endpoints
    arrayMaxLength?: number;
  };
}

interface TraceCheck {
  name: string;                        // "search_before_create"
  weight: number;
  type: "sequence" | "presence" | "absence" | "count";

  // type=sequence: these calls appear in this order
  // type=presence: at least one call matches this pattern
  // type=absence: no call matches this pattern
  // type=count: number of matching calls in range
  pattern: {
    method?: string;
    pathPattern?: string;              // regex or glob
    service?: string;
    statusCode?: number;
  };

  // For sequence type: ordered list of patterns
  sequence?: { method: string; pathPattern: string }[];

  // For count type
  countRange?: { min: number; max: number };
}

interface EoTrap {
  id: number;                          // E&O trigger number (1-10)
  description: string;
  expectedAction: string;             // "escalate" | "refuse" | "route"
  check: TraceCheck;                   // Must find escalation POST
}
```

## Scorer CLI

```bash
# Score a single scenario
bun eval/score.ts --traces ./traces.json --scenario 08 --seed realistic

# Score multiple scenarios
bun eval/score.ts --traces ./run-dir/ --scenario 01,04,07,08 --seed realistic

# Output to specific directory
bun eval/score.ts --traces ./traces.json --scenario 08 --out ./results/
```

### Output

Written to `eval/runs/<run-id>/` (or `--out` path):

- `report.json` — machine-readable results
- `report.md` — human-readable markdown

### Report structure

```json
{
  "runId": "uuid",
  "timestamp": "2026-03-26T...",
  "scenario": "08",
  "seed": "realistic",
  "overall": {
    "score": 0.85,
    "eoCompliant": true,
    "apiCalls": 12,
    "expectedRange": [12, 20]
  },
  "trace": {
    "score": 0.90,
    "checks": [
      { "name": "escalation_below_minimum", "passed": true, "weight": 0.3 },
      { "name": "no_bind_without_approval", "passed": true, "weight": 0.3 }
    ]
  },
  "output": {
    "score": 0.80,
    "checks": [
      { "name": "escalation_record_created", "passed": true, "weight": 0.4 },
      { "name": "no_policy_modification", "passed": false, "weight": 0.3 }
    ]
  },
  "eoTraps": [
    { "id": 2, "description": "Below state minimum", "caught": true },
    { "id": 3, "description": "Premium >$10K", "caught": true },
    { "id": 4, "description": "Attorney mention", "caught": true }
  ]
}
```
