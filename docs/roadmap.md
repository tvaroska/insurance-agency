# Roadmap (`insurance-agency`)

## Where we are

`v0.9` is complete on `main` (`20` workflows / `259` tasks across 8 deterministic SQLite services, `11/11` multi-turn `DT` scenarios, `53/53` `validate-harness` variants, `1,496` conformance passes, `12/12` `tsc --noEmit` clean, frozen simulated clock at `2026-10-14T12:00:00.000Z`, calibrated `gemini-4-argon` rubric judge across 120 gold items, and a 480-trial `v0.9` leaderboard sweep published in `eval/results/v0.9/` and `README.md`). Next up: close the remaining `P3.1` harness/conformance/decomposition hygiene items (`v0.9.1`), then run the wider difficulty sweep, two-rater 60-trial blind human audit, and publication gates for the `v1.0.0` arXiv preprint.

## Milestones at a glance

| # | Milestone | Done when | Target |
| :--- | :--- | :--- | :--- |
| **M1** | `v0.9.1` — OpenEnv Seed Parity, Hermetic Tests, Conformance & File Decomposition | Custom-seed OpenEnv tasks score without crashing, `pytest` runs in `< 3s` without scanning live `v0.9` `.eval` logs, conformance cleanup & `choices=None` retries land, oversized files split `<= 800` LOC, and `proj-test insurance-agency` + `roadmap-archive --check` pass. | `v0.9.1` (`P1`/`P2`, Small) |
| **M2** | `v1.0.0` — Wider Difficulty Sweep, Blind Human Audit & arXiv Preprint Readiness | Two-rater 60-trial blind audit scored, `natural`/`vague`/`adversarial` × 5-trial sweep published with replay manifests, arXiv endorser & publication approval cleared, and 8–10 page `cs.AI`/`cs.SE` draft ready. | `v1.0.0` (`P1`, Medium) |

## Milestone 1 — `v0.9.1`: OpenEnv Seed Parity, Hermetic Tests, Conformance & File Decomposition

- [ ] **M1-1: Fix OpenEnv custom-seed variant collapse (`P3.1`)** — Stop `eval/openenv/evergreen_env.py` (`lines 130, 136, 537`) from collapsing non-`clean` `task["seed"]` variants (such as `09-moderate-natural`) to `--seed realistic`, which crashes `eval/score.ts` across the 14 custom-seed tasks (`moderate`, `severe`, `market-exit`) in `tasks.json` (`done when`: all 14 custom-seed tasks score cleanly through `evergreen_env.py` and unit tests cover non-`realistic` messy seeds).
- [ ] **M1-2: Make `test_summarize_inspect.py` hermetic & fast (`P3.1`)** — Decouple `eval/inspect/tests/test_summarize_inspect.py` (`lines 264–290`) from scanning live `eval/results/v0.9/` `.eval` archives (`done when`: local and Cloud Build `pytest` drops from `~125s` to `< 3s` using fixture logs).
- [ ] **M1-3: Conformance harness cleanup, Vertex MaaS retry guard & `v1.0` API alignment (`P3.1`)** — Implement child cleanup (`stop()`) in `tests/conformance/harness/service.ts`, guard transient Vertex MaaS `choices=None` responses in `eval/inspect/run_baseline.py` retry logic, and coordinate centralized malformed-JSON `400`s (`packages/shared/src/errors.ts`), exact Rater `risk_category` JSON-array matching, and `specs/ams.yaml` tool-surface alignment (`Coverage.limit`, `SMIT`/`CSTL`, `renters`, `state`/`escalation_id`) with the 7 conformance files (`AMS-R4`, `CLM-R07`, etc.) (`done when`: `proj-test insurance-agency` and conformance suites pass with zero leaked child processes).
- [ ] **M1-4: File decomposition (`<= 800` LOC) & `regulatory.md` scoping (`P3`)** — Split `eval/agents/baseline-agent.ts` and `services/ams/src/routes/workbench.ts` to `<= 800` LOC each, and clearly separate the 10 active benchmark E&O triggers in `regulatory.md` from background agency context (`done when`: both files are `<= 800` LOC and `proj-test insurance-agency` passes).

## Milestone 2 — `v1.0.0`: Wider Difficulty Sweep, Blind Human Audit & arXiv Preprint Readiness

- [ ] **M2-1: Complete two-rater 60-trial blind human audit (`P2.4`)** — Mark `AUD-01`..`AUD-60` in `eval/results/v0.8/blind-audit-60-sheet.md` across two independent raters and score agreement (`kappa`, Gwet's `AC1`) with `eval/inspect/score_blind_audit.py` to back grader validity after the post-first-sweep collateral-rule tightening (`done when`: inter-rater agreement receipt is committed and referenced in the paper draft).
- [ ] **M2-2: Run wider difficulty sweep to separate models** — Run the `natural`, `vague`, and `adversarial` tiers at 5 trials each (300 trials/arm, `~$310` list / `~$180` net at calibrated rates; passes the pre-sweep pilot gate in `AGENTS.md` first) to resolve statistical ties at `n = 20` and produce a difficulty curve (`done when`: all `.eval` headers report `status == "success"`, `summary.md` + `replay-manifest.json` are committed, and artifact bundles are synced to `gs://btvaroska/insurance-agency/results/`).
- [ ] **M2-3: Clear publication gates & draft arXiv preprint** — In parallel with `M2-1`/`M2-2`, secure an arXiv endorser (`cs.AI` / `cs.SE`) and employer publication approval, then draft the 8–10 page paper (problem, environment, grading, `v0.8`/`v0.9` + wider run, error taxonomy from [`docs/v08-failure-analysis.md`](v08-failure-analysis.md) & [`docs/v09-failure-analysis.md`](v09-failure-analysis.md), limitations; framed as one worked domain) (`done when`: endorser + approval recorded and preprint draft is ready for submission).

## Unscheduled backlog

- **Optional additional `v0.9` ablation arms (`E2`/`E4`/`E5`):** Policy-prompt, permissive-modality GUI-vs-REST, and extra model arms (subject to the pre-sweep pilot and cost gates in `AGENTS.md`).
- **Automated `GEPA` / reflective trace evolution:** Automated skill/prompt evolution over the fixed 10-train / 10-holdout workflow split.
- **`CPVO` + Inspect `.eval` bridge to `bq-eval`:** Export Inspect `.eval` traces and 32-table state-diff verdicts into `bq-eval` for Rogan-Gladen CPVO analysis.
- **Second small-business benchmark domain (`v2` / follow-up paper):** Small 4–5 service domain (e.g., bookkeeping practice with a browser-only tax portal, ~10 workflows) reusing the harness, state-diff grader, collateral policy, and Inspect pipeline (~3–6 weeks).

## Shipped

- **`v0.9` (`P0`–`P3.0`, 2026-11-15 to 2026-11-17)** — Statistical/denominator hygiene, strict-modality workbench isolation, frozen `2026-10-14` simulated clock, mandatory browser-only carrier portals, live `gemini-4-argon` rubric calibration (`94.17%` acc, `Gwet's AC2 = 0.9333`), Rater `bind` guards, 480-trial 10/10 train/holdout sweep, seeded RNG determinism, and `12/12` `tsc` + CI `pytest` parity — [archive](archive/roadmap-history.md#v09-hardening-calibration-480-trial-sweep-p0p30)
- **`v0.8.0` (2026-11-11)** — Harness & E&O firewall hardening (`ADR-006`), 259 tasks (`53/53` green), 454-trial first full `pass^5` sweep, billing-calibrated cost model, offline Error Taxonomy, and 60-trial blind audit kit — [archive](archive/roadmap-history.md#v080-harness-hardening-first-full-sweep)
- **`v0.7.0` (2026-11-10)** — Knowledge-work benchmark reframing, `ADR-005` Inspect AI + LangChain `agent_bridge()` harness, service-side `/sim/trace`, strict portal sessions, and initial 3-model leaderboard — [archive](archive/roadmap-history.md#v070-benchmark-framing-first-leaderboard)
- **`v0.6.0`** — GM3 Light Executive Workbench (`bun run showcase`), 1st-Line compliance firewall, ACORD 25 PDF generator, and 3-Stage Agent-to-Code showcase — [archive](archive/roadmap-history.md#v060-executive-operations-governance-showcase)
- **`v0.5.0`** — Exact state diffing, strict 3-modality enforcement, multi-turn customer simulator, Pareto economics, and Inspect AI / OpenEnv / HAL adapters — [archive](archive/roadmap-history.md#v050-small-business-model-harness-benchmark-suite)
- **`v0.1.0`–`v0.4.0`** — Scorer MVP, 15-scenario coverage, METR TaskFamily, Prisma 7 migration, and Harbor adapter — [archive](archive/roadmap-history.md#v010-to-v040-foundation-scenario-coverage-metr-prisma-harbor)
