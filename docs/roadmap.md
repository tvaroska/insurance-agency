# Evergreen Insurance Agency — Product Roadmap

**Last Updated:** 2026-11-15

## Strategic Overview

High-level priorities and feature areas for Evergreen, a first step in benchmarking AI agents on knowledge work: a simulated small-business insurance agency that agents work in across REST APIs, MCP, and web UIs.

---

## Competitive Landscape & Positioning

> See [docs/benchmark-landscape.md](benchmark-landscape.md) for the full comparative analysis of public small-business/enterprise benchmarks, interoperability standards (METR, Harbor, Inspect AI, OpenEnv, HAL), and Sprint 0 architectural review findings.

| Benchmark | Origin | Focus | How Evergreen Gym Differentiates |
| :--- | :--- | :--- | :--- |
| **TheAgentCompany** | CMU / All Hands AI | Simulated software company (GitLab, Plane, RocketChat, OwnCloud) | Evergreen targets regulated main-street small business operations with lightweight microservices instead of heavy SWE/IT stacks. |
| **AppWorld** | Stony Brook / AI2 | 9 consumer apps, 457 REST APIs, DB state diffing | Evergreen tests B2B/small-business compliance (E&O triggers, underwriting, ACORD forms) and hybrid REST + MCP + Web UI modalities. |
| **$\tau$-bench / $\tau^2$-bench** | Sierra / Princeton | Customer support policy compliance + mock JSON tools | Evergreen combines OTLP trace scoring + live service state, adversarial dirty-data hygiene (deduplication, book audits), and async HITL manager escalations. |
| **CRMArena-Pro / WorkArena** | Salesforce / ServiceNow | Single-platform CRM or ERP UI workflows | Evergreen requires cross-system orchestration across 8 independent services (AMS, Rater, CRM, ECM, Comm MCP, Claims, 2 Carrier Portals). |
| **Vending-Bench 2** | Andon Labs | Long-horizon small business net-worth simulation | Evergreen tests deep operational & regulatory fidelity across 5 prompt framing tiers (`scripted` → `adversarial`). |

---

## Feature Areas

### Evaluation System & Benchmark Rigor

**Status:** Complete (v0.5.0)
**Priority:** P0
**Progress:** 100%

Goals:
- Scorer with output + trace evaluation (done)
- 20 benchmark scenarios (15 single-turn + 5 interactive multi-turn scenarios, 259 total cases across 5 prompt difficulty tiers) (done)
- Per-trap E&O payload verification & audit output checks (`S0-BUG-2`, `S0-BUG-3`, done)
- Snapshot-based exact DB state diffing & collateral damage detection (`S3-DIFF-1`, done)
- Strict 3-modality enforcement (`MODALITY_MODE=strict`) for REST + MCP + Browser harnesses (`S3-MOD-1`, done)
- Interactive multi-turn customer & underwriter simulator (`S3-SIM-1`, done)
- Cost, token efficiency & latency Pareto scoring (`S3-ECON-1`, done)
- Time simulation & chaos injection (`S3-SIM-2`, done)

### Interoperability & Harness Benchmarking

**Status:** Complete (v0.5.0)
**Priority:** P1
**Progress:** 100%

Goals:
- METR Task Standard v0.5.0 compatibility — 259 tasks exported via `eval/metr/EvergreenInsurance.py` (`S0-BUG-1`, `S1-INTOP-1`, done)
- **Harbor / Terminal-Bench framework adapter** (`S2-INTOP-1`, done) — packages tasks for zero-code execution across Claude Code, OpenHands, Codex CLI, Goose, and Aider
- Native UK AISI `Inspect AI` `@task` with multi-container Docker Compose sandboxing & native MCP (`S3-INTOP-2`, done)
- OpenEnv & Prime Intellect `verifiers` RL Gym Control Plane (`/sim/reset`, `/sim/snapshot`, `/sim/time-travel`, `/sim/chaos`) (`S3-INTOP-3`, done)
- Princeton HAL (`hal-harness`) Cost-vs-Score leaderboard exporter (`S3-INTOP-4`, done)
- Reference multi-harness runner & comparative leaderboard (`S3-HARN-1`, done)

### Infrastructure

**Status:** Complete (v0.5.0; canonical SQLite isolation finalized in `ADR-006`)
**Priority:** P1
**Progress:** 100%

Goals:
- Drizzle → Prisma 7 migration across all 8 services + runtime startup seeding (`S2-DB-1..4`, done)
- Canonical per-service SQLite (`EVERGREEN_DATA_DIR`) + `< 100ms` in-process `/sim/reset` + Cloud Build CI (`S2-TEST-1`, `ADR-006`, done; unverified K8s/CloudNativePG manifests retired in `ADR-006`)

---

## Release Plan

### v0.1.0 — Scorer MVP (done)

- Scorer CLI with output + trace evaluation
- 4 scenarios implemented (01, 04, 07, 08)
- GenAI semconv trace parser
- Clean + realistic seed variants

### v0.2.0 — Full Scenario Coverage (done)

- All 15 scenarios implemented (218 cases)
- Unit + integration tests for evaluators

### v0.3.0 — METR Interop & Prisma Migration (done)

- METR TaskFamily wrapper (203 tasks)
- Prisma Client across all 8 services + runtime container seeding

### v0.4.0 — K8s, PostgreSQL, Harbor & Scorer Hardening (Complete)

- Sprint 0 review bug fixes (`S0-BUG-1..3`, `S0-DEBT-1..2`)
- Harbor / Terminal-Bench task adapter (`S2-INTOP-1`)
- Prisma test setup cleanup (`S2-TEST-1`)
- CloudNativePG + K8s manifests & Docker Compose PG override (`S2-K8S-1..4`, `S2-COMPOSE-1`)

### v0.5.0 — Small-Business Model & Harness Benchmark Suite (Complete)

- Snapshot-based exact state diffing (`S3-DIFF-1`)
- Strict modality enforcement (`S3-MOD-1`)
- Multi-turn customer simulator (`S3-SIM-1`)
- Cost/latency Pareto scoring & multi-harness runner (`S3-ECON-1`, `S3-HARN-1`)
- Native Inspect AI, OpenEnv / `verifiers` RL control plane, and HAL export (`S3-INTOP-2..4`)

### v0.6.0 — Insurance Technology Executive Operations & Governance Showcase (Complete)

- 4-tab GM3 Light Executive Workbench mounted on AMS (`GET /` on `:3000`) + `bun run showcase` zero-Docker launcher
- 1st-Line service-layer E&O and 10-state statutory minimum firewall (`packages/shared/src/compliance-firewall.ts`)
- Real ACORD 25 Certificate of Insurance PDF generation (`services/ecm/src/templates/acord-25.ts`)
- 20-scenario playable baseline trajectories (`eval/agents/baseline-agent.ts`) and 3-Stage Agent-to-Code evolution runner (`eval/evolution-showcase.ts`)
- Self-contained GM3 Light Executive HTML Scorecard (`docs/executive-scorecard.html`) and Executive Story Spine (`design/story.md`, `EXECUTIVE-BRIEF.md`)

### v0.7.0: Benchmark Framing & First Leaderboard (done)

- Done: `README.md` reframed as an agent benchmark for small-business work outside coding (one worked task, the 20 workflows, scoring, harness adapters, comparison, limitations); the product narrative and modeled economics stay in `design/story.md` and `EXECUTIVE-BRIEF.md`
- Done: benchmark card hero (`docs/assets/benchmark_card.svg`)
- Done: statutory minimums match the law in force on the benchmark date: CA 30/60/15 (since 2025-01-01) and NC 50/100/50 (since 2025-07-01)
- Done (2026-11-10): `README.md` reframed as a first step in benchmarking agents on knowledge work; the workflow table's task counts now match `eval/harbor/tasks-manifest.json` (253, pinned by a test); Results is a placeholder until the implementation phase; product material moved behind `docs/README.md`, the service table into `docs/architecture.md`, and the judge-bias note into `docs/evaluation.md`
- Done (2026-11-10, `ADR-005`): Models (`gemini-3.8-flash`, `claude-sonnet-5-5`, and `DeepSeek-V4.1-Flash` on Vertex AI) and harness selected and built:
  - Service-side OTLP request log (`packages/shared/src/request-log.ts`, `GET /sim/trace`, `X-Evergreen-Internal: 1` exclusion) and multi-service collector (`eval/collect-trace.ts`)
  - Strict portal-session enforcement (`packages/shared/src/sim.ts` issued-token store, `Referer` bypass removed, carrier UIs rebuilt)
  - LangChain agent run inside UK AISI Inspect AI via `agent_bridge()` (`eval/inspect/evergreen_langchain.py`, `eval/inspect/openapi_tools.py`: 48 typed OpenAPI REST tools, Comm MCP, and Playwright MCP headless Chrome; zero shell)
  - Pre-spend harness validation (`eval/validate-harness.ts`): `20/20` scenarios verified live (`1.000` scripted / `0.000` no-op)
  - 3-model `scripted` smoke run verified live across all 3 models on `01`, `14`, `20` (`MODALITY_MODE=strict`) after applying `bridge_filters()` in `eval/inspect/evergreen_langchain.py` and list-argument support in `eval/inspect/evergreen.py`:
    - `google/gemini-3.8-flash`: `mean = 0.802` (`01 = 0.760`, `14 = 0.646`, `20 = 1.000`, `eo_compliant = True` on `3/3`)
    - `anthropic/vertex/claude-sonnet-5-5`: `mean = 0.822` (`01 = 0.760`, `14 = 0.706`, `20 = 1.000`, `eo_compliant = True` on `3/3`)
    - `openai-api/vertex-maas/deepseek-ai/deepseek-v4.1-flash-maas`: `mean = 0.822` (`01 = 0.760`, `14 = 0.706`, `20 = 1.000`, `eo_compliant = True` on `3/3`)
- Done (2026-11-10): Scenario and route alignments exposed by the 3-model `realistic-scripted` smoke run:
  - `services/ams/src/routes/clients.ts`: filter `GET /v1/clients` by `query.first_name` (`startsWith`) when provided, so `01-realistic`'s `no_duplicate_created` check (`GET /clients?last_name=Chen&first_name=Sarah`, `arrayMaxLength: 2`) does not include `CLI-002` (`James Chen`) alongside `Sarah Chen` (`CLI-001`) and `Sara Chen` (`CLI-030`)
  - `eval/scenarios/14-lead-qualification.ts`: align `14-realistic` prompts with its `traceChecks`/`outputChecks` (mention sending an acknowledgment message and creating a follow-up task, as `14-clean` does)
  - `eval/inspect/summarize_inspect.py` & `eval/inspect/run_baseline.py`: Inspect `.eval` log-to-README Results table aggregator and 3-model Vertex AI runner (`--strict` flag added to `scripts/run-showcase.ts`)
- Done (2026-11-10): Initial 3-model `natural` strict evaluation (`01,03,07,14,19,20`, `MODALITY_MODE=strict`, `realistic` + `clean` seeds = 36 samples) published in `README.md` (`I1`/`I2`/`I3`) and `docs/assets/benchmark_card.svg`:
  - `google/gemini-3.8-flash`: `pass@1 = 66.7%` (`4/6`: passed `01`, `14`, `19`, `20`; `mean = 0.683`; `0/1 sys · 1/3 judg`; `16.7%` said done when check failed; `$0.068/task`)
  - `anthropic/vertex/claude-sonnet-5-5`: `pass@1 = 50.0%` (`3/6`: passed `14`, `19`, `20`; `mean = 0.620`; `0/1 sys · 1/3 judg`; `50.0%` said done when check failed; `$0.079/task`)
  - `openai-api/vertex-maas/deepseek-ai/deepseek-v4.1-flash-maas`: `pass@1 = 33.3%` (`2/6`: passed `14`, `19`; `mean = 0.532`; `1/1 sys · 1/3 judg`; `66.7%` said done when check failed; `$0.010/task`)
- Done (2026-11-10): Consolidated engine, OpenAPI spec, and `clean` seed prompt fixes exposed by the `v0.7.0` natural run across `01,03,07,14,19,20` (note: the initial `README.md` Results table was recorded before the `clean`-seed prompt fix; a full 20-workflow `pass^5` re-run is next):
  - `specs/rater.yaml`: added `GET /quotes` (`listQuotes` with `client_id`, `policy_type`, `status`, `carrier_code`, `limit`, `cursor` query parameters) matching `services/rater/src/routes/quotes.ts` (`lines 77–131`) and Scenario `03`'s `verify_quote` check (`GET /v1/quotes`), so OpenAPI-driven agents can discover existing quote request IDs (`QR-001`) on unscripted prompts without guessing
  - `services/ecm/src/routes/envelopes.ts` & `specs/ecm.yaml`: implemented `GET /v1/envelopes` (`client_id`, `status`, `limit` query filters) so `03-realistic`'s `signature_requested` `outputCheck` (`GET /envelopes?client_id=CLI-003&limit=50`) returns `200` with created envelopes
  - `eval/scenarios/01..15` & `data/seed-clean/leads.json`: grounded `clean` variant prompts (`scripted` through `adversarial`) across Scenarios `01`–`15` with concrete `seed-clean` client/quote/claim/lead identifiers (matching Scenarios `16`–`20`) and aligned `14-clean` lead `lead_a1b2c3d4` (`Jessica Williams`) initial status to `"contacted"` so the `clean`-to-`realistic` control arm measures data messiness rather than missing entity names in `clean` prompts
- Done (2026-11-11): executed the first full 20-workflow `pass^5` leaderboard sweep (`v0.8.0` below) and replaced projected Stage 2 skill target rates in `eval/evolution-showcase.ts`, `docs/executive-scorecard.html`, and `services/ams/src/routes/workbench.ts` with measured 5-trial `v0.8` Domain Skill results (`69.0%` `pass@1`, `60.2%` `pass^5`)
- Done (2026-11-11): replaced `docs/assets/benchmark_card.svg` with a real failing-run receipt (`06-realistic-natural`, `claude-sonnet-5-5`, epoch 1) selected by a deterministic rule documented in [`docs/v08-failure-analysis.md`](v08-failure-analysis.md)

### v0.8.0: Harness Hardening & First Full Sweep (done)

- Done (2026-11-11, `ADR-006`): `/showcase-panel` R1 to R3 hardening. Scorer crash on `specs/ast.rules.yaml` fixed; in-process reset with `EVERGREEN_DATA_DIR`; tracked service `.db` files removed; E&O firewall escalation bypass closed (rater bind returns 422, state minimums never waivable, escalations must match client, policy and reason); scorer secret, portal bootstrap cookie and `/mcp` JWT under strict mode; `collateralPolicy` on all variants; Drizzle, PG and K8s removed; 120-item rubric gold set (`eval/calibration/`, Gwet AC2 0.93, deterministic checker TPR 0.967 / TNR 0.90); `validate-harness` 53/53 across 259 tasks
- Done (2026-11-11): a first consolidated sweep exposed scorer and runner defects; it was run once as-is, set aside, and all findings were fixed in one pass before the published run:
  1. Collateral scoring flagged correct escalations: escalations, escalation events and review tasks are now exempt from policy scope and from `maxTotalMutations`, book-wide scenarios (04, 10, 15) set `governanceAnyClient`, and the penalty is 0.1 per unasked write capped at 0.5
  2. Scenario 12 realistic was tagged `CLI-012` while Rosa Jimenez is `CLI-018` in the seed; dual-name prompts in Scenarios 12 and 13 were removed; Scenario 08 now allows the address-change endorsements on Priya Patel's two policies
  3. Receipt bundles now include the learning mechanism in their path, so arms never overwrite each other
  4. `seed=realistic` falls back to a scenario's first messy variant (09 uses `moderate`); variants without a case at the requested difficulty are skipped
  5. "Drop, clean to messy" compares an arm only with its own clean runs, on the scenarios both seeds cover
  6. `run_baseline.py` collects job failures and still summarizes; stack data dirs are keyed by port so parallel runners do not collide
  7. A pre-sweep pilot gate (1 trial per workflow on every arm) is now required before a production sweep (`AGENTS.md`)
- Done (2026-11-11): published v0.8 run (`eval/results/v0.8/`, 454 trials: 20 workflows x 5 trials realistic for 4 arms, 18 workflows x 1 trial clean for the 3 zero-shot arms; `claude-sonnet-5-5` on a separate Vertex AI project). Results table in `README.md`, `docs/assets/benchmark_card.svg`, `docs/executive-scorecard.html`, `eval/evolution-showcase.ts` and the workbench. Raw replay bundles (trace, before/after snapshots, report, `sha256sums.txt`) are archived outside git; `replay-manifest.json` in the repo carries every trial's hashes and paths
- Done (2026-11-11): "Cost per task" uses Vertex AI list prices calibrated against the Cloud Billing export (per 1M tokens: `gemini-3.8-flash` 1.50 input / 7.50 output / 0.15 cached; `DeepSeek-V4.1-Flash` 0.30 / 1.20 / 0.03; `claude-sonnet-5-5` 2.00 / 10.00 / 0.10 cached read / 2.50 cache write), synced across both `eval/inspect/summarize_inspect.py` and `eval/evaluators/economics.ts`. At list price the v0.8 day cost about $216 (first sweep $77, pilot $28, published run $111)
- Done (2026-11-11): added a `clean` `natural` task to Scenario 08 (`08-clean-natural`) and a 5-case `clean` variant to Scenario 09 (`09-clean-*`), bringing the suite to **259 tasks** (`53/53` `validate-harness` variants green) so future clean controls cover all `20/20` workflows
- Done (2026-11-11): completed 454-trial offline **Error Taxonomy** (`59.1%` missing follow-through records, `19.5%` uncaught judgment E&O traps, `12.6%` incomplete primary state changes, `5.0%` collateral penalties, `3.8%` system E&O traps), diagnosed the exact Domain Skill regressions on Scenarios `01` (`updateLead` instead of `createLead`) and `02` (unnecessary single-turn VIN clarification SMS + portal detour) in [`docs/v08-failure-analysis.md`](v08-failure-analysis.md), and generated the **60-trial stratified blind human audit sheet + sealed key + agreement scorer** ([`eval/results/v0.8/blind-audit-60-sheet.md`](../eval/results/v0.8/blind-audit-60-sheet.md), [`eval/inspect/score_blind_audit.py`](../eval/inspect/score_blind_audit.py))

### Next Up: v0.9 Hardening & Paper Readiness (P0 to P3)

#### P0 — Public Credibility, Math & Firewall Hygiene (Done, 2026-11-15, `$0` LLM spend; preserves `v0.8` logs)
- **Done (`P0.1` Statistical & Denominator Hygiene):** Task-clustered `N = 20` bootstrap 95% CIs on multi-epoch `pass@1` in `eval/inspect/summarize_inspect.py`, explicit `said_done_given_failed_rate` (`57.8%` to `69.0%` conditional vs. `26.0%` to `29.0%` unconditional across all runs) and `deferred_rate` (`39.0%` overall vs. `19.0%` failed-and-deferred on `claude-sonnet-5-5`) synced into `README.md`, `EXECUTIVE-BRIEF.md`, `docs/assets/benchmark_card.svg`, and `eval/results/v0.8/summary*`.
- **Done (`P0.2` Strict-Modality Workbench Isolation & Showcase Parity):** Block `/` and `/workbench/*` on AMS (`:3000`) with `HTTP 403 MODALITY_VIOLATION` whenever `MODALITY_MODE=strict` (unless `ENABLE_SHOWCASE_WORKBENCH=1`), preserving the `/v1/*`-only `/sim/trace` contract; made `GET /workbench/api/overview` purely read-only (moving demo sample seeding to `POST /workbench/api/seed-escalations`), aligned `/workbench/api/time-travel` with `pending_review -> applied`, returned `404` on unknown document IDs in `/workbench/api/documents/:docId/pdf`, and aligned `BOOK_ANOMALIES` and `evolutionStages` with seed entities and measured `v0.8` metrics.
- **Done (`P0.3` Showcase & Report Provenance Cleanup):** Replaced hardcoded `3,900 ms` / `1,650 ms` latencies, `eoComplianceRate: 1.0`, `0.97` fallback `pass@1`, and conflicting `$0.0029` vs. `$0.7741` CPVO constants in `eval/evolution-showcase.ts` with measured `v0.8` figures; fixed Scenario `02`/`09`/`11`/`14` modalities (`Browser Portal + REST + MCP` on `09` and `11`), `"3 / 10 HTTP 422"` firewall KPI, and `"Deterministic 32-Table State Diff"` in `eval/report.ts` and `docs/executive-scorecard.html`.
- **Done (`P0.4` Model Catalog & Calibrated Pricing):** Landed `gemini-4-hydrogen`, `gemini-4-argon`/`carbon` (`$4/$20`), `gpt-oss-120b`, `gemma-4-26b-a4b-it`, and `resolve_selected_models()` in `eval/evaluators/economics.ts` and `eval/inspect/run_baseline.py`.

#### P1 — Benchmark, Clock & Carrier-Portal Validity (Done, 2026-11-15; consolidated pre-`v0.9` pass)
- **Done (`P1.1` De-Leak `"None (zero-shot)"` Prompt & Domain Skill Fixes):** Stripped the explicit 10-rule E&O checklist from `learning_mechanism="none"` in `eval/inspect/evergreen_langchain.py`, added a dedicated `"policy_prompt"` arm alongside `"domain_skill"`, fixed `evergreen_domain_skill.md` §2/§4/§7 (`createLead` for net-new callers, existing-quote VIN path without single-turn SMS pause, and full escalation reason list), and exposed `claims_specialist`/`claim_specialist` in `specs/ams.yaml` (`EscalationCreate`/`Escalation`).
- **Done (`P1.2` Freeze Unified Simulated Clock at `2026-10-14T12:00:00.000Z`):** Anchored `BENCHMARK_SIMULATED_TODAY = "2026-10-14"`, `getSimulatedNow()`, `getSimulatedToday()`, and monotonic `nextSimulatedEpochMs()` (reset on `/sim/reset` and `/sim/seed`) in `packages/shared/src/sim.ts`, routed domain timestamps across all 8 services through the simulated clock (keeping real wall-clock timestamps strictly for JWT/portal session TTLs, access logs, `/health`, and latency timers), shifted `data/seed/` + `data/seed-clean/` (`+8` months including 2026 Q3/September commission statements), Scenarios `01..20`, and `DT-01..DT-10` coherently to `2026-10-14`, and documented the frozen clock across `README.md`, `AGENTS.md`, `regulatory.md`, `docs/architecture.md`, `docs/evaluation.md`, `eval/deterministic/README.md`, and `specs/*.spec.md`.
- **Done (`P1.3` Scenario Grader, Prompt & Accounting Fixes):** Fixed `13-realistic` fraudulent COI check (`POST /v1/(documents/coi/generate|coi)` + `ecm.documents` check), `08` dead `PATCH` check (`POST /v1/policies/POL-PA-2026-000030/endorsements`) and scoped escalation reasons (`07`, `08`), `10-realistic` auto-resolved escalation status acceptance (`pending|approved|needs_info|denied`), invalid `reason_code` prompt strings (`06`, `07`, `13`) + `CLI-019` `CA` state (`09-moderate`) enforced by `eval/__tests__/escalation-reasons-contract.test.ts`, `17` / `DT-05` pending-endorsement COI scope, `DT-06` Turn-3 optional duplicate `principal_review` escalation and `ecm.envelopes` allowances, and `?policy_id=` filtering in `services/ams/src/routes/accounting.ts` (`specs/ams.yaml`).
- **Done (`P1.4` Mandatory Browser-Only Carrier Portal Workflows & `permissive` Ablation):** Wired `carrier-coastal` (`:3006`, `QT-002-CSTL` risk-assessment/recalculation) into Scenario `09`, `carrier-summit` (`:3005`, `POL-HO-2025-000312` inspection documents on `clean` and `POST /v1/summit/submissions` BOP intake on `realistic`) into Scenario `11`, added `DT-11-portal-summit-property-submission.yaml` (`11/11` `DT` scenarios verified), loaded `carrier-summit` and `carrier-coastal` OpenAPI specs (`68` vs. `56` tools) in `eval/inspect/openapi_tools.py` when `modality_mode == "permissive"` so `E4` measures GUI-vs-REST directly, and fixed Coastal UI `1HG -> Honda` VIN decode and payment-plan display bugs (rebuilt `services/carrier-coastal/public/`).
- **Done (`P1.5` Follow-Through Prompt Alignment & Clean-vs.-Realistic E&O Trap Parity):** Clarified natural follow-through prompts (`06`, `11`, `12`, `15`), matched prompt-side `0%`-override E&O trap counts on `08-clean` (`3` traps matching `08-realistic`) and `10-clean` (`2` traps matching `10-realistic`) without polluting `data/seed-clean/`, regenerated Harbor/METR task manifests (`259` tasks), and verified `53/53` `validate-harness` variants (`1.000` scripted / `0.000` no-op).

#### P2 — External Harnesses, Rubric Calibration & Rater Guards (Code & Live Judge Calibration Done, 2026-11-15; Human Audit Deferred)
- **Done (`P2.1` Harbor & OpenEnv Parity):** Synced Harbor task instructions (`2026-10-14` simulated clock + strict MCP/portal session guidance) and added `harbor-snapshot-init` pre-run 32-table snapshot capture (`/workspace/traces/snapshot-before.json`) in `eval/harbor/export-harbor.ts` and `eval/harbor/docker-compose.harbor.yaml`; added automatic OAuth Bearer JWT acquisition, strict `/mcp` `tools/call` routing for `comm`, carrier portal session bootstrap (`X-Portal-Session`), and `09-moderate` inclusion (`20/20` realistic scenarios) in `eval/openenv/evergreen_env.py`.
- **Done (`P2.2` Live `gemini-4-argon` Rubric Judge Calibration & Scale Normalization):** Normalized all `ordinal_4` criteria across Scenarios `02`, `05`, `11`, `12`, `15`, `16`, `17`, `18`, `19`, and `20` onto `[0, 1]` (`passingScore: 0.66`), enforced `expectedEvaluatorMode` isolation between `calibration-receipt.json` (`deterministic-rule`) and `calibration-receipt.llm.json` (`vertex-llm-judge`) so offline regex `TPR/TNR` is never applied to `--llm-judge`, added bounded concurrency (`--concurrency 8`), timeouts, retries, and JSONL checkpointing to `eval/calibration/calibrate-judge.ts`, and calibrated `gemini-4-argon` live on Vertex global across all 120 gold items (`eval/calibration/calibration-receipt.llm.json`: `TPR = 0.8833` `53/60`, `TNR = 1.0000` `60/60`, `Youden's J = 0.8833`, `accuracy = 94.17%`, `F1 = 0.9381`, human-human `Gwet's AC2 = 0.9333`).
- **Done (`P2.3` Rater `bind` Status/Expiry Guards & ECM Document Link):** Updated `POST /v1/quotes/:quote_id/bind` (`services/rater/src/routes/quotes.ts`, `specs/rater.yaml`, `specs/rater.spec.md`, `tests/conformance/rater/bind.test.ts` `117/117` pass) to reject non-`quoted` statuses (`pending`, `expired`, `error`, `underwriting_hold`) and quotes past `valid_until` relative to `getSimulatedToday()` with `409 CONFLICT`, pointed `policy_documents_url` at ECM (`${ECM_BASE_URL}/v1/documents?client_id=...`), and documented intentional Rater/AMS DB isolation.
- **Deferred (`P2.4` Two-Rater 60-Trial Blind Human Audit):** Mark `AUD-01`..`AUD-60` in `eval/results/v0.8/blind-audit-60-sheet.md` across two independent raters and score with `eval/inspect/score_blind_audit.py` ($\kappa$, Gwet's `AC1`).
- **Done (`P2.5` 10/10 Skill Train/Holdout Split & Full 480-Trial `v0.9` Sweep, 2026-11-15):** Landed fixed 10-train (`01,02,04,06,08,09,12,14,16,18`) and 10-holdout (`03,05,07,10,11,13,15,17,19,20`) workflow split constants (`--scenario train|holdout` in `eval/inspect/run_baseline.py` and `--split {all,train,holdout}` + `train_pass_at_1` / `holdout_pass_at_1` in `eval/inspect/summarize_inspect.py`), ran the 80-trial `v0.9-pilot` gate (`eval/results/v0.9-pilot/`, resolving cross-scenario customer-pivot simulator collisions via `activeScenarioId` on `POST /sim/reset` and book-wide audit table caps), and executed the full 480-trial `v0.9` sweep (`eval/results/v0.9/`, `$128.84` list, replay bundles synced to GCS, analyzed in [`docs/v09-failure-analysis.md`](v09-failure-analysis.md)): `gemini-3.8-flash` + Domain Skill `83.0%` `pass@1` (`84.0%` train, `82.0%` holdout, `73.7%` `pass^5`, `-12.0 pp` clean-to-messy drop), `gemini-3.8-flash` zero-shot `67.0%` (`58.7%` `pass^5`, `-28.0 pp` drop), `claude-sonnet-5-5` `66.0%` (`55.0%` `pass^5`, `-9.0 pp` drop, `0.01` unasked writes), and `DeepSeek-V4.1-Flash` `56.0%` (`31.5%` `pass^5`, `-4.0 pp` drop, `$0.039/task`); optional additional `E2`/`E4`/`E5` arms follow pilot cost gates in `AGENTS.md`.

#### P3 — Conformance Debt, CI Parity & Decomposition
- **Conformance & CI Parity:** Implement child cleanup in `tests/conformance/harness/service.ts` (`stop()`), clear ECM's in-memory COI PDF map on `/sim/reset`, fix malformed-JSON `500`s across 6 services + exact `risk_category` matching, guard Vertex MaaS `choices=None` transient responses in `eval/inspect/run_baseline.py` retry wrapper, and add `conformance` to `proj-test` and `cloudbuild.yaml`.
- **File Decomposition (`<= 800 LOC`) & `regulatory.md` Scoping:** Split `eval/agents/baseline-agent.ts` and `services/ams/src/routes/workbench.ts`, and clearly separate the 10 active benchmark E&O triggers in `regulatory.md` from background agency context.
- **Deferred Platform Extensions:** Automated `GEPA` / reflective trace evolution over train/holdout splits, and `CPVO` + Inspect `.eval` bridge to `~/projects/bq-eval`.

### arXiv Paper (planned, not started)

Assessment (2026-11-11): the v0.8 run is enough for an honest single-domain benchmark paper. A second business is the stronger version but should not block v1; add it as v2 or a follow-up paper.

- What already carries a paper: a new environment (8 separate systems over REST, MCP, and browser-only portals; legal traps the systems do not catch; grading on what changed in every database, not on the transcript), a real experiment (454 trials, 4 arms, confidence intervals, clean-versus-messy control, procedure-guide comparison, billing-calibrated cost), and reproducibility (scripted reference 100%, do-nothing 0%, 120-item rubric gold set, per-trial replay hashes)
- Strengthen before drafting (likely reviewer attacks):
  1. Models are statistically tied at n = 20 (one natural prompt per workflow). Run the natural, vague, and adversarial tiers at 5 trials each (300 trials per arm, about $310 list / $180 net at calibrated rates) to separate models and add a difficulty curve; the full 259 prompts x 3 trials is about $810 list
  2. Grader validity: the collateral rules were tightened after the first sweep. Disclose this and back it with the 60-trial blind hand audit (`eval/results/v0.8/blind-audit-60-sheet.md` + `eval/inspect/score_blind_audit.py`; template & sealed key staged, human marking pending)
  3. Error taxonomy: classified across all 454 `v0.8` trials in [`docs/v08-failure-analysis.md`](v08-failure-analysis.md) (`59.1%` missing follow-through record, `19.5%` uncaught judgment E&O trap, `12.6%` incomplete primary state change, `5.0%` collateral penalty, `3.8%` system E&O trap)
  4. Generalization: one business cannot carry "benchmarking knowledge work" as a general claim. Frame v1 as one worked domain ("a first step"); a second business turns the paper into a framework shown on two domains
- Second business option: small (4 to 5 systems, about 10 workflows), for example a bookkeeping practice with a browser-only tax portal, reusing the harness, state-diff grader, collateral policy, and Inspect pipeline. Estimate 3 to 6 weeks with agent help
- Gates, start in parallel either way: an arXiv endorser in the target category (first-time submitters need one unless they have an institutional email and an existing paper there), and employer publication approval (which approval process covers this repo is not yet recorded)
- Suggested shape: cs.AI with cs.SE cross-list, 8 to 10 pages (problem, environment, grading, v0.8 plus the wider run, failure analysis, limitations)
- Open decision: (a) wider sweep and hand audit, then draft; (b) draft from v0.8 now; or (c) build the second business first. Recommended: (a), with the gates in parallel and the second business after v1 is posted
