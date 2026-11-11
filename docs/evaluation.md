# Evergreen Insurance — Evaluation System

Scores AI agent performance on benchmark scenarios across **output & 32-table state-diff scoring** (60% weight), **OTLP trace scoring** (40% weight), **hard E&O compliance gates** (`0%` override on any uncaught statutory/regulatory trap), and **calibrated `EVAL-P01..P10` communication rubrics**.

## Architecture

```
Agent (Inspect AI / Harbor / METR / any framework)     Gym (8 Bun + SQLite services, strict modality)
     │                                                          │
     │── REST (/v1/*) + MCP (/mcp) + Browser (:3005/:3006) ────►│ records service-side OTLP spans
     │                                                          │ & maintains 32 SQLite tables
     ▼                                                          ▼
GET /sim/snapshot (before & after) + GET /sim/trace (eval/collect-trace.ts)
     │
     ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Scorer (bun eval/score.ts)                                            │
│                                                                        │
│  Trace evaluator (40%) ◄── reads OTLP JSON (service-side or agent)     │
│    • API call sequence & MCP tool normalization                        │
│    • Efficiency (call count vs expected range)                         │
│    • Error recovery (4xx handling)                                     │
│    • E&O compliance (escalation POST presence)                         │
│                                                                        │
│  Output & State-Diff evaluator (60%) ◄── REST APIs + 32-table diff     │
│    • Record existence, field values, counts & cross-service FKs        │
│    • collateralPolicy enforcement (allowedClientIds, maxTotalMutations)│
│                                                                        │
│  Rubric evaluator (EVAL-P01..P10)                                      │
│    • Offline default: deterministic-rule (no uncalibrated LLM CI)      │
│    • Optional --llm-judge: Vertex AI calibrated on rubric_gold_120.json│
│                                                                        │
│  ──► report.json + report.md (+ optional executive-scorecard.html)     │
└────────────────────────────────────────────────────────────────────────┘
```

## Design Decisions

### Service-side traces (`ADR-005` & `ADR-006`)

Agent-emitted OpenTelemetry traces still work, and all benchmark harnesses are scored from service-side OTLP spans recorded directly by the 8 services ([`packages/shared/src/request-log.ts`](../packages/shared/src/request-log.ts)), so REST, MCP, and Playwright browser portal actions share one exact scoring path without requiring agent-side OTel SDKs:

- **Recorded:** requests to `/v1/*`, and MCP `tools/call` requests to `POST /mcp` on `comm` (tagged with `mcp.tool.name`).
- **Not recorded:** internal service-to-service calls (`X-Evergreen-Internal: 1`, gated by `EVERGREEN_SCORER_SECRET` when configured), `/oauth/*`, `/auth/*`, `/sim/*`, `/health`, `/workbench*`, static assets, and MCP handshake (`initialize`), `tools/list`, and notification messages.
- **Lifecycle:** `POST /sim/reset` reseeds the service's isolated SQLite database in `< 100ms` via in-process `seedDatabase()` and clears the request log; `GET /sim/trace` exports the OTLP JSON spans.

```bash
# End-to-end 20-scenario harness validation (isolated /tmp EVERGREEN_DATA_DIR):
# verifies scripted reference agent = 1.000 and no-op agent = 0.000 on all 20 workflows
bun eval/validate-harness.ts

# Collect service-side traces & score a live run with before/after snapshots:
bun eval/collect-trace.ts --out ./traces.json
bun eval/score.ts --traces ./traces.json --scenario 08 --seed realistic \
  --snapshot-before ./snapshot-before.json --snapshot-after ./snapshot-after.json
```

`EVERGREEN_BASE_URLS` (a JSON map such as `{"ams":"http://localhost:3100",...}`) or `EVERGREEN_BASE_PORT` (`3100` -> `:3100..:3107`) overrides service base URLs for multi-stack parallel evaluation (`eval/inspect/run_baseline.py --parallel-stacks N`). When `EVERGREEN_SCORER_SECRET` is set, scorer endpoints (`X-Eval-Scorer: true` on `/sim/snapshot` and strict-mode REST inspection) require matching `X-Evergreen-Scorer-Secret`.

### REST API + 32-Table Snapshot State Diffing (`collateralPolicy`)

Output grading combines public REST endpoint assertions ([`eval/evaluators/output.ts`](../eval/evaluators/output.ts)) with exact primary-key pre/post database state diffing across all **32 SQLite tables in all 8 services** ([`eval/evaluators/state-diff.ts`](../eval/evaluators/state-diff.ts)):

- Every variant across all 20 scenarios defines an explicit `collateralPolicy` (`allowedClientIds`, optional `allowedPolicyIds`, and tight `maxTotalMutations`).
- Mutating records belonging to uninvolved clients or inserting excess junk rows triggers `unauthorizedMutations` and deducts a deterministic `collateralPenalty` from the output score.
- When `apiCallCount === 0` (a do-nothing agent), `eval/report.ts` caps `overall.score` at `0.000` even if read-only seed assertions would otherwise match.

### Decoupled Scorer Lifecycle

1. Start the 8-service stack in strict mode (`bun run showcase --strict` or `docker compose up`, which defaults `MODALITY_MODE` to `strict`).
2. Reset to the target seed (`POST /sim/reset` with `{"seed_mode":"realistic"}` or `"clean"`) and capture `snapshot-before.json` (`GET /sim/snapshot`).
3. Run any agent framework against REST (`:3000–3003`, `:3007`), MCP (`:3004/mcp`), and browser portals (`:3005`, `:3006`).
4. Collect `traces.json` (`bun eval/collect-trace.ts`) and `snapshot-after.json`, then run `bun eval/score.ts`.

## Trace Format

Spans follow [OTel HTTP semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-spans/):

| Attribute | Convention | Example | Used for |
|-----------|-----------|---------|----------|
| `http.request.method` | Stable | `POST` | API call identification |
| `url.full` | Stable | `http://localhost:3000/v1/clients` | Service + endpoint routing |
| `http.response.status_code` | Stable | `201` | Success/error detection (2xx required by default on `presence`/`sequence`) |
| `server.port` | Stable | `3000` | Service identification |
| `mcp.tool.name` | Extension | `send_message` | Normalizes `POST /mcp` calls on `:3004` to canonical comm operations |

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

### Trace evaluator (`40%`)

| Dimension | What it measures | Scoring |
|-----------|-----------------|---------|
| **API call sequence** | Did the agent call the right endpoints in a valid order (with 2xx responses)? | Subsequence pattern matching against expected call sequences |
| **Presence / Absence** | Were required lookups made and prohibited shortcuts avoided? | Binary per check (`absence` also catches failed 4xx attempts at forbidden mutations) |
| **Efficiency** | How many API calls vs expected range? | `1.0` within `[min, max]`, degrades outside range |
| **E&O compliance** | Did the agent escalate mandatory triggers (`regulatory.md`)? | Binary per trap (`check` trace check + client-scoped `outputCheck`); any uncaught trap overrides scenario score to `0.000` |

### Output & State-Diff evaluator (`60%`)

| Dimension | What it measures | Scoring |
|-----------|-----------------|---------|
| **Record existence & values** | Were expected records created/updated with accurate fields? | Weighted REST assertions (`bodyMatch`, `arrayMinLength`, `arrayItemMatch`) |
| **Relationship integrity** | Do cross-service foreign keys align (policy ID, client ID, escalation reason)? | Verified across AMS, Rater, CRM, ECM, Comm, Carrier Portals, and Claims |
| **Collateral-free execution** | Zero unasked cross-client edits or excess mutations? | 32-table `diffSnapshots` checked against `collateralPolicy` |

### Rubric checks (`EVAL-P01..P10`), 120-item gold calibration & optional Vertex LLM judge

Free-text outbound communications in 10 workflows (`02`, `05`, `11`, `12`, `15`, and `16–20`) are evaluated against the 10 atomic single-aspect criteria in [`eval/evaluators/rubric.ts`](../eval/evaluators/rubric.ts) (`EVAL-P01`–`EVAL-P10`: binary and 4-point ordinal scales only, mandatory `reasoningTrace` before `score`/`passed`, XML input sanitization, and `CONTRADICTION_AWARE_4PT_STEPS`):

1. **Offline Deterministic Default (`judgeModel: "deterministic-rule"`):** When `--llm-judge` is not passed (`useLlmJudge = false`), `eval/score.ts` runs deterministic rule-based communication checks offline at `$0` cost and reports `judgeModel: "deterministic-rule"` without applying synthetic LLM-judge Rogan-Gladen confidence intervals.
2. **120-Item Dual-Expert Gold Calibration Benchmark (`eval/calibration/rubric_gold_120.json`):** Contains 120 realistic insurance communication outputs (12 items per `EVAL-P01..P10` criterion spanning subtle coverage promises, raw SSN leaks, partial statutory disclosures, and compliant refusals) with independent `rater_a` and `rater_b` annotations, adjudicated gold `label`, and inter-annotator agreement Gwet's `AC2 >= 0.85`. Running `bun eval/calibration/calibrate-judge.ts` computes Gwet's `AC2`, the confusion matrix `(TP, FP, TN, FN)`, and empirical `(TPR, TNR, nPos, nNeg)` saved to `eval/calibration/calibration-receipt.json`.
3. **Optional Vertex AI Judge (`--llm-judge` / `EVERGREEN_USE_LLM_JUDGE=1`):** Passing `--llm-judge` invokes `createVertexJudgeFn()` (`gemini-4-argon` default on Vertex AI) and applies `roganGladenDebiasedPassRate` (`theta_hat` + 95% CI) using the calibrated `(TPR, TNR, nPos, nNeg)` receipt rather than uncalibrated placeholder constants.

### Combined score

```
scenario_score = 0                                                   if apiCallCount == 0 or not eoCompliant
               = (0.40 * trace_score) + (0.60 * output_with_diff)    otherwise
```

Headline benchmark tables report deterministic state/trace scores separately from optional LLM-judge rubric scores (`ADR-005`).

## Scorer CLI

```bash
# Score a single scenario (deterministic offline mode)
bun eval/score.ts --traces ./traces.json --scenario 08 --seed realistic \
  --snapshot-before ./before.json --snapshot-after ./after.json

# Score with calibrated Vertex AI LLM rubric judge enabled
bun eval/score.ts --traces ./traces.json --scenario 08 --seed realistic --llm-judge

# Calibrate rubric judge against the 120-item gold dataset
bun eval/calibration/calibrate-judge.ts
```
