# Roadmap History (`insurance-agency`)

Archived shipped releases (`v0.1.0` through `v0.9` `P3.0`) and completed feature areas moved out of [`../roadmap.md`](../roadmap.md) on `2026-11-18`.

---

## v0.9 Hardening, Calibration & 480-Trial Sweep (P0–P3.0)

### P0 — Public Credibility, Math & Firewall Hygiene (2026-11-15, `$0` LLM spend; preserves `v0.8` logs)

- **P0.1 Statistical & Denominator Hygiene:** Task-clustered `N = 20` bootstrap 95% CIs on multi-epoch `pass@1` in `eval/inspect/summarize_inspect.py`, explicit `said_done_given_failed_rate` (`57.8%` to `69.0%` conditional vs. `26.0%` to `29.0%` unconditional across all runs) and `deferred_rate` (`39.0%` overall vs. `19.0%` failed-and-deferred on `claude-sonnet-5-5`) synced into `README.md`, `EXECUTIVE-BRIEF.md`, `docs/assets/benchmark_card.svg`, and `eval/results/v0.8/summary*`.
- **P0.2 Strict-Modality Workbench Isolation & Showcase Parity:** Block `/` and `/workbench/*` on AMS (`:3000`) with `HTTP 403 MODALITY_VIOLATION` whenever `MODALITY_MODE=strict` (unless `ENABLE_SHOWCASE_WORKBENCH=1`), preserving the `/v1/*`-only `/sim/trace` contract; made `GET /workbench/api/overview` purely read-only (moving demo sample seeding to `POST /workbench/api/seed-escalations`), aligned `/workbench/api/time-travel` with `pending_review -> applied`, returned `404` on unknown document IDs in `/workbench/api/documents/:docId/pdf`, and aligned `BOOK_ANOMALIES` and `evolutionStages` with seed entities and measured `v0.8` metrics.
- **P0.3 Showcase & Report Provenance Cleanup:** Replaced hardcoded `3,900 ms` / `1,650 ms` latencies, `eoComplianceRate: 1.0`, `0.97` fallback `pass@1`, and conflicting `$0.0029` vs. `$0.7741` CPVO constants in `eval/evolution-showcase.ts` with measured `v0.8` figures; fixed Scenario `02`/`09`/`11`/`14` modalities (`Browser Portal + REST + MCP` on `09` and `11`), `"3 / 10 HTTP 422"` firewall KPI, and `"Deterministic 32-Table State Diff"` in `eval/report.ts` and `docs/executive-scorecard.html`.
- **P0.4 Model Catalog & Calibrated Pricing:** Landed `gemini-4-hydrogen`, `gemini-4-argon`/`carbon` (`$4/$20`), `gpt-oss-120b`, `gemma-4-26b-a4b-it`, and `resolve_selected_models()` in `eval/evaluators/economics.ts` and `eval/inspect/run_baseline.py`.

### P1 — Benchmark, Clock & Carrier-Portal Validity (2026-11-15; consolidated pre-`v0.9` pass)

- **P1.1 De-Leak `"None (zero-shot)"` Prompt & Domain Skill Fixes:** Stripped the explicit 10-rule E&O checklist from `learning_mechanism="none"` in `eval/inspect/evergreen_langchain.py`, added a dedicated `"policy_prompt"` arm alongside `"domain_skill"`, fixed `evergreen_domain_skill.md` §2/§4/§7 (`createLead` for net-new callers, existing-quote VIN path without single-turn SMS pause, and full escalation reason list), and exposed `claims_specialist`/`claim_specialist` in `specs/ams.yaml` (`EscalationCreate`/`Escalation`).
- **P1.2 Freeze Unified Simulated Clock at `2026-10-14T12:00:00.000Z`:** Anchored `BENCHMARK_SIMULATED_TODAY = "2026-10-14"`, `getSimulatedNow()`, `getSimulatedToday()`, and monotonic `nextSimulatedEpochMs()` (reset on `/sim/reset` and `/sim/seed`) in `packages/shared/src/sim.ts`, routed domain timestamps across all 8 services through the simulated clock (keeping real wall-clock timestamps strictly for JWT/portal session TTLs, access logs, `/health`, and latency timers), shifted `data/seed/` + `data/seed-clean/` (`+8` months including 2026 Q3/September commission statements), Scenarios `01..20`, and `DT-01..DT-10` coherently to `2026-10-14`, and documented the frozen clock across `README.md`, `AGENTS.md`, `regulatory.md`, `docs/architecture.md`, `docs/evaluation.md`, `eval/deterministic/README.md`, and `specs/*.spec.md`.
- **P1.3 Scenario Grader, Prompt & Accounting Fixes:** Fixed `13-realistic` fraudulent COI check (`POST /v1/(documents/coi/generate|coi)` + `ecm.documents` check), `08` dead `PATCH` check (`POST /v1/policies/POL-PA-2026-000030/endorsements`) and scoped escalation reasons (`07`, `08`), `10-realistic` auto-resolved escalation status acceptance (`pending|approved|needs_info|denied`), invalid `reason_code` prompt strings (`06`, `07`, `13`) + `CLI-019` `CA` state (`09-moderate`) enforced by `eval/__tests__/escalation-reasons-contract.test.ts`, `17` / `DT-05` pending-endorsement COI scope, `DT-06` Turn-3 optional duplicate `principal_review` escalation and `ecm.envelopes` allowances, and `?policy_id=` filtering in `services/ams/src/routes/accounting.ts` (`specs/ams.yaml`).
- **P1.4 Mandatory Browser-Only Carrier Portal Workflows & `permissive` Ablation:** Wired `carrier-coastal` (`:3006`, `QT-002-CSTL` risk-assessment/recalculation) into Scenario `09`, `carrier-summit` (`:3005`, `POL-HO-2025-000312` inspection documents on `clean` and `POST /v1/summit/submissions` BOP intake on `realistic`) into Scenario `11`, added `DT-11-portal-summit-property-submission.yaml` (`11/11` `DT` scenarios verified), loaded `carrier-summit` and `carrier-coastal` OpenAPI specs (`68` vs. `56` tools) in `eval/inspect/openapi_tools.py` when `modality_mode == "permissive"` so `E4` measures GUI-vs-REST directly, and fixed Coastal UI `1HG -> Honda` VIN decode and payment-plan display bugs (rebuilt `services/carrier-coastal/public/`).
- **P1.5 Follow-Through Prompt Alignment & Clean-vs.-Realistic E&O Trap Parity:** Clarified natural follow-through prompts (`06`, `11`, `12`, `15`), matched prompt-side `0%`-override E&O trap counts on `08-clean` (`3` traps matching `08-realistic`) and `10-clean` (`2` traps matching `10-realistic`) without polluting `data/seed-clean/`, regenerated Harbor/METR task manifests (`259` tasks), and verified `53/53` `validate-harness` variants (`1.000` scripted / `0.000` no-op).

### P2 — External Harnesses, Live Judge Calibration, Rater Guards & `v0.9` Sweep (2026-11-15)

- **P2.1 Harbor & OpenEnv Parity:** Synced Harbor task instructions (`2026-10-14` simulated clock + strict MCP/portal session guidance) and added `harbor-snapshot-init` pre-run 32-table snapshot capture (`/workspace/traces/snapshot-before.json`) in `eval/harbor/export-harbor.ts` and `eval/harbor/docker-compose.harbor.yaml`; added automatic OAuth Bearer JWT acquisition, strict `/mcp` `tools/call` routing for `comm`, carrier portal session bootstrap (`X-Portal-Session`), and `09-moderate` inclusion (`20/20` realistic scenarios) in `eval/openenv/evergreen_env.py`.
- **P2.2 Live `gemini-4-argon` Rubric Judge Calibration & Scale Normalization:** Normalized all `ordinal_4` criteria across Scenarios `02`, `05`, `11`, `12`, `15`, `16`, `17`, `18`, `19`, and `20` onto `[0, 1]` (`passingScore: 0.66`), enforced `expectedEvaluatorMode` isolation between `calibration-receipt.json` (`deterministic-rule`) and `calibration-receipt.llm.json` (`vertex-llm-judge`) so offline regex `TPR/TNR` is never applied to `--llm-judge`, added bounded concurrency (`--concurrency 8`), timeouts, retries, and JSONL checkpointing to `eval/calibration/calibrate-judge.ts`, and calibrated `gemini-4-argon` live on Vertex global across all 120 gold items (`eval/calibration/calibration-receipt.llm.json`: `TPR = 0.8833` `53/60`, `TNR = 1.0000` `60/60`, `Youden's J = 0.8833`, `accuracy = 94.17%`, `F1 = 0.9381`, human-human `Gwet's AC2 = 0.9333`).
- **P2.3 Rater `bind` Status/Expiry Guards & ECM Document Link:** Updated `POST /v1/quotes/:quote_id/bind` (`services/rater/src/routes/quotes.ts`, `specs/rater.yaml`, `specs/rater.spec.md`, `tests/conformance/rater/bind.test.ts` `117/117` pass) to reject non-`quoted` statuses (`pending`, `expired`, `error`, `underwriting_hold`) and quotes past `valid_until` relative to `getSimulatedToday()` with `409 CONFLICT`, pointed `policy_documents_url` at ECM (`${ECM_BASE_URL}/v1/documents?client_id=...`), and documented intentional Rater/AMS DB isolation.
- **P2.5 10/10 Skill Train/Holdout Split & Full 480-Trial `v0.9` Sweep (2026-11-15):** Landed fixed 10-train (`01,02,04,06,08,09,12,14,16,18`) and 10-holdout (`03,05,07,10,11,13,15,17,19,20`) workflow split constants (`--scenario train|holdout` in `eval/inspect/run_baseline.py` and `--split {all,train,holdout}` + `train_pass_at_1` / `holdout_pass_at_1` in `eval/inspect/summarize_inspect.py`), ran the 80-trial `v0.9-pilot` gate (`eval/results/v0.9-pilot/`, resolving cross-scenario customer-pivot simulator collisions via `activeScenarioId` on `POST /sim/reset` and book-wide audit table caps), and executed the full 480-trial `v0.9` sweep (`eval/results/v0.9/`, `$128.84` list, replay bundles synced to GCS, analyzed in [`../v09-failure-analysis.md`](../v09-failure-analysis.md)): `gemini-3.8-flash` + Domain Skill `83.0%` `pass@1` (`84.0%` train, `82.0%` holdout, `73.7%` `pass^5`, `-12.0 pp` clean-to-messy drop), `gemini-3.8-flash` zero-shot `67.0%` (`58.7%` `pass^5`, `-28.0 pp` drop), `claude-sonnet-5-5` `66.0%` (`55.0%` `pass^5`, `-9.0 pp` drop, `0.01` unasked writes), and `DeepSeek-V4.1-Flash` `56.0%` (`31.5%` `pass^5`, `-4.0 pp` drop, `$0.039/task`).

### P3.0 — Determinism, 12/12 `tsc --noEmit`, CI `pytest` & Cross-Scenario Reset Parity (2026-11-17)

- Replaced all 13 `Math.random()` and 7 domain `crypto.randomUUID()` sites in `services/*/src/` with episode-seeded `simRandom()`/`simRandomId()`/`simRandomHex()`/`simRandomUuid()` (`no-unseeded-math-random` AST rule in `specs/ast.rules.yaml`), cleared ECM's in-memory COI PDF cache (`clearCoiPdfStore()`) and AMS workbench simulation state (`resetWorkbenchState()`) on `POST /sim/reset`, restored `bun run typecheck` (`0` errors across all `12/12` `tsconfig*.json` files) in `proj-test` and `cloudbuild.yaml` alongside `CI=true` `ast-grep` enforcement, a non-skipping `python-tests` step, and the `conformance` target (`1,496 pass / 89 todo / 0 fail`), and forwarded `scenario_id` + scorer headers on `POST /sim/reset` across Harbor (`harbor-snapshot-init`), METR (`TaskFamily.start()`), and OpenEnv TS (`eval/openenv/client.ts`).

---

## v0.8.0 — Harness Hardening & First Full Sweep

- **2026-11-11 (`ADR-006`):** `/showcase-panel` R1 to R3 hardening. Scorer crash on `specs/ast.rules.yaml` fixed; in-process reset with `EVERGREEN_DATA_DIR`; tracked service `.db` files removed; E&O firewall escalation bypass closed (rater bind returns 422, state minimums never waivable, escalations must match client, policy and reason); scorer secret, portal bootstrap cookie and `/mcp` JWT under strict mode; `collateralPolicy` on all variants; Drizzle, PG and K8s removed; 120-item rubric gold set (`eval/calibration/`, Gwet AC2 0.93, deterministic checker TPR 0.967 / TNR 0.90); `validate-harness` 53/53 across 259 tasks.
- **2026-11-11:** Consolidated scorer and runner fixes from the first sweep:
  1. Collateral scoring exempted escalations, escalation events, and review tasks from policy scope and `maxTotalMutations`; book-wide scenarios (04, 10, 15) set `governanceAnyClient`; penalty set to `0.1` per unasked write capped at `0.5`.
  2. Scenario 12 realistic aligned to `CLI-018` (Rosa Jimenez); dual-name prompts in Scenarios 12 and 13 removed; Scenario 08 allowed address-change endorsements on Priya Patel's two policies.
  3. Receipt bundles keyed by learning mechanism to prevent arm overwrites.
  4. `seed=realistic` falls back to a scenario's first messy variant (09 uses `moderate`); missing-difficulty variants skipped.
  5. "Drop, clean to messy" compares each arm only against its own clean runs on overlapping scenarios.
  6. `run_baseline.py` collects job failures and still summarizes; stack data dirs keyed by port.
  7. Pre-sweep pilot gate (1 trial per workflow on every arm) required in `AGENTS.md`.
- **2026-11-11:** Published `v0.8` run (`eval/results/v0.8/`, 454 trials: 20 workflows × 5 trials realistic for 4 arms, 18 workflows × 1 trial clean for 3 zero-shot arms). Results synced into `README.md`, `docs/assets/benchmark_card.svg`, `docs/executive-scorecard.html`, `eval/evolution-showcase.ts`, and workbench.
- **2026-11-11:** Calibrated Vertex AI list prices synced across `eval/inspect/summarize_inspect.py` and `eval/evaluators/economics.ts`.
- **2026-11-11:** Added `08-clean-natural` and `09-clean-*`, bringing the suite to 259 tasks (`53/53` `validate-harness` green).
- **2026-11-11:** Completed 454-trial offline Error Taxonomy (`59.1%` missing follow-through records, `19.5%` uncaught judgment E&O traps, `12.6%` incomplete primary state changes, `5.0%` collateral penalties, `3.8%` system E&O traps) in [`../v08-failure-analysis.md`](../v08-failure-analysis.md), and generated the 60-trial blind human audit sheet + sealed key + agreement scorer ([`../../eval/results/v0.8/blind-audit-60-sheet.md`](../../eval/results/v0.8/blind-audit-60-sheet.md), [`../../eval/inspect/score_blind_audit.py`](../../eval/inspect/score_blind_audit.py)).

---

## v0.7.0 — Benchmark Framing & First Leaderboard

- `README.md` reframed as a first step in benchmarking agents on knowledge work; benchmark card hero (`docs/assets/benchmark_card.svg`) replaced with a real failing-run receipt (`06-realistic-natural`, `claude-sonnet-5-5`, epoch 1); statutory minimums updated to CA 30/60/15 and NC 50/100/50.
- `ADR-005` harness built: service-side OTLP request log (`packages/shared/src/request-log.ts`, `GET /sim/trace`), strict portal-session enforcement, LangChain agent inside Inspect AI via `agent_bridge()` (48 typed OpenAPI REST tools, Comm MCP, Playwright MCP; zero shell), pre-spend `validate-harness` (`20/20` green), and initial 3-model `scripted` and `natural` strict runs.
- Route/spec alignments: `GET /v1/clients?first_name=`, `GET /quotes` in `specs/rater.yaml`, `GET /v1/envelopes` in `services/ecm/src/routes/envelopes.ts` & `specs/ecm.yaml`, and grounded `clean` seed identifiers across Scenarios `01`–`15`.

---

## v0.6.0 — Executive Operations & Governance Showcase

- 4-tab GM3 Light Executive Workbench mounted on AMS (`GET /` on `:3000`) + `bun run showcase` zero-Docker launcher.
- 1st-Line service-layer E&O and 10-state statutory minimum firewall (`packages/shared/src/compliance-firewall.ts`).
- Real ACORD 25 Certificate of Insurance PDF generation (`services/ecm/src/templates/acord-25.ts`).
- 20-scenario playable baseline trajectories (`eval/agents/baseline-agent.ts`) and 3-Stage Agent-to-Code evolution runner (`eval/evolution-showcase.ts`).
- Self-contained GM3 Light Executive HTML Scorecard (`docs/executive-scorecard.html`) and Executive Story Spine (`design/story.md`, `EXECUTIVE-BRIEF.md`).

---

## v0.5.0 — Small-Business Model & Harness Benchmark Suite

- Snapshot-based exact state diffing (`S3-DIFF-1`), strict modality enforcement (`S3-MOD-1`), multi-turn customer simulator (`S3-SIM-1`), cost/latency Pareto scoring & multi-harness runner (`S3-ECON-1`, `S3-HARN-1`), and native Inspect AI, OpenEnv/`verifiers` RL control plane, and HAL export (`S3-INTOP-2..4`).

---

## v0.1.0 to v0.4.0 — Foundation, Scenario Coverage, METR, Prisma & Harbor

- **v0.4.0:** Sprint 0 review bug fixes (`S0-BUG-1..3`, `S0-DEBT-1..2`), Harbor / Terminal-Bench task adapter (`S2-INTOP-1`), Prisma test setup cleanup (`S2-TEST-1`), and initial K8s/PG manifests (later retired in `ADR-006`).
- **v0.3.0:** METR TaskFamily wrapper (203 tasks), Prisma Client across all 8 services + runtime container seeding.
- **v0.2.0:** All 15 initial scenarios implemented (218 cases), unit + integration tests for evaluators.
- **v0.1.0:** Scorer CLI with output + trace evaluation, 4 scenarios (01, 04, 07, 08), GenAI semconv trace parser, clean + realistic seed variants.

---

## Competitive Landscape & Positioning (Baseline Snapshot)

> Full comparative analysis lives in [`../benchmark-landscape.md`](../benchmark-landscape.md).

| Benchmark | Origin | Focus | How Evergreen Gym Differentiates |
| :--- | :--- | :--- | :--- |
| **TheAgentCompany** | CMU / All Hands AI | Simulated software company (GitLab, Plane, RocketChat, OwnCloud) | Evergreen targets regulated main-street small business operations with lightweight microservices instead of heavy SWE/IT stacks. |
| **AppWorld** | Stony Brook / AI2 | 9 consumer apps, 457 REST APIs, DB state diffing | Evergreen tests B2B/small-business compliance (E&O triggers, underwriting, ACORD forms) and hybrid REST + MCP + Web UI modalities. |
| **$\tau$-bench / $\tau^2$-bench** | Sierra / Princeton | Customer support policy compliance + mock JSON tools | Evergreen combines OTLP trace scoring + live service state, adversarial dirty-data hygiene (deduplication, book audits), and async HITL manager escalations. |
| **CRMArena-Pro / WorkArena** | Salesforce / ServiceNow | Single-platform CRM or ERP UI workflows | Evergreen requires cross-system orchestration across 8 independent services (AMS, Rater, CRM, ECM, Comm MCP, Claims, 2 Carrier Portals). |
| **Vending-Bench 2** | Andon Labs | Long-horizon small business net-worth simulation | Evergreen tests deep operational & regulatory fidelity across 5 prompt framing tiers (`scripted` → `adversarial`). |
