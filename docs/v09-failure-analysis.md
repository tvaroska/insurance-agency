# Evergreen v0.9 — Post-Hardening Failure Taxonomy, Train/Holdout Generalization & Simulator Isolation

Empirical post-run analysis of all **480 Inspect AI trials** in [`eval/results/v0.9/`](../eval/results/v0.9/) (`400` realistic `natural` trials across 4 arms at `k = 5` + `80` clean `natural` control trials across all `20/20` workflows and all 4 arms at `k = 1`, `$128.84` Vertex AI list cost), executed after freezing the simulated clock at `2026-10-14T12:00:00.000Z`, removing zero-shot guardrail hints from `learning_mechanism="none"`, wiring mandatory browser-only carrier portals into Scenarios `09` and `11`, and scoping customer-pivot simulator rules to the active scenario (`eval/results/v0.9-pilot/` holds the 80-trial pre-sweep pilot). Historical `v0.8` analysis (`454` trials) remains archived in [`docs/v08-failure-analysis.md`](v08-failure-analysis.md).

---

## 1. Six-Class Primary Failure Taxonomy (`128 / 400` Failed Realistic Trials)

Every trial that scored below `0.80` or missed a mandatory Errors and Omissions (E&O) trigger (`128` of `400` realistic trials, `32.0%`; `15` of `80` clean trials, `18.8%`) is assigned to one mutually exclusive root-cause class following the scorer's evaluation hierarchy:

| Code | Failure Class | Realistic Fails (`n = 128`) | Share of Fails | `gemini-3.8-flash` + Domain Skill (`17` fails) | `gemini-3.8-flash` Zero-Shot (`33` fails) | `claude-sonnet-5-5` Zero-Shot (`34` fails) | `DeepSeek-V4.1-Flash` Zero-Shot (`44` fails) | Clean Control Fails (`n = 15`) |
| :---: | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **`T1`** | **System E&O Trap Missed** (`eoCompliant = false` on statutory minimum, `>$10K` bind, or backdating) | `3` | `2.3%` | `2` | `1` | `0` | `0` | `0` |
| **`T2`** | **Judgment E&O Trap Missed** (`eoCompliant = false` solely on the 7 judgment-only duties) | `22` | `17.2%` | `0` | `11` | `5` | `6` | `0` |
| **`T3`** | **Missing Follow-Through Record** (primary read/check done, but required task, envelope, lead, or confirmation omitted) | **`93`** | **`72.7%`** | `15` | `17` | `28` | `33` | `13` |
| **`T4`** | **Incomplete Primary State Change** (core domain mutation such as `POST /claims` or `POST /envelopes` never executed) | `1` | `0.8%` | `0` | `0` | `1` | `0` | `0` |
| **`T5`** | **Collateral Mutation Penalty** (pre-penalty score `>= 0.80`, tipped below `0.80` by unasked writes to other clients/tables) | `9` | `7.0%` | `0` | `4` | `0` | `5` | `1` |
| **`T6`** | **Trace Verification / Budget Miss** (`output_score = 1.00`, failed on call order, missing verification read, or API budget) | `0` | `0.0%` | `0` | `0` | `0` | `0` | `1` |

*(Note: In `gemini-3.8-flash` + Domain Skill, the `2` `T1` multi-trap trials on Scenario `08` accounted for `3/30` missed system trap checks and `2/60` missed judgment trap checks simultaneously; zero trials failed on judgment traps alone.)*

### Key Takeaways
1. **Eliminating environment & clock noise makes operational follow-through even sharper (`72.7%` of all realistic failures, `86.7%` of clean failures):** Once the `2026-10-14` simulated clock, carrier-portal bindings, and cross-scenario simulator collisions were resolved, `T4` incomplete primary mutations fell from `20` (`v0.8`) to `1`, leaving skipped follow-up writes (`ams.tasks`, `ecm.envelopes`, `crm.leads`, `comm.messages`) as nearly three-quarters of all benchmark failures.
2. **Trace-guided Domain Skill v2 generalizes cleanly (`84.0%` train vs. `82.0%` unseen holdout) and halves the messy-data cliff:** Refining [`evergreen_domain_skill.md`](../eval/inspect/evergreen_domain_skill.md) §2/§4/§7 resolved both `v0.8` negative flips (`01`: `1/5 -> 5/5`; `02`: `1/5 -> 3/5`), lifted `gemini-3.8-flash` from `67.0%` to `83.0%` overall (`74.0% -> 84.0%` on the 10 train workflows; **`60.0% -> 82.0%` on the 10 unseen holdout workflows**), reduced missed judgment trap checks by `83.3%` (`12/60 -> 2/60`), and cut the 20-workflow clean-to-messy drop by `57%` (`-28.0 pp` zero-shot from `95.0%` clean vs. `-12.0 pp` Domain Skill from `95.0%` clean).
3. **Reliability (`pass^5`) and false-completion calibration separate models far wider than `pass@1`:** `gemini-3.8-flash` (`67.0%` `pass@1`, `58.7%` `pass^5`, `15.0%` false-done / `45.5%` on fails) and `claude-sonnet-5-5` (`66.0%` `pass@1`, `55.0%` `pass^5`, `16.0%` false-done / `47.1%` on fails, `46.0%` explicit deferral, `0.01` unasked writes) substantially outperform `DeepSeek-V4.1-Flash` on consistency (`56.0%` `pass@1`, `31.5%` `pass^5`, `34.0%` false-done / **`77.3%` on failed runs**), despite `DeepSeek-V4.1-Flash` costing `12.2x` less per task (`$0.039` vs. `$0.476`).
4. **Mandatory browser-only carrier portals are solvable under `MODALITY_MODE=strict`:** With Playwright MCP + `/auth/portal-session` cookie/token enforcement wired directly into Scenario `09` (*Coastal Star Auto* `:3006`) and Scenario `11` (*Summit Fire & Casualty* `:3005`), agents passed `17/20` (`85%`) realistic trials on `09` (`12/15` zero-shot, `5/5` Domain Skill) and `18/20` (`90%`) on `11` (`13/15` zero-shot, `5/5` Domain Skill).

---

## 2. Per-Workflow Pass Matrix (`v0.9`, `k = 5` Realistic / `k = 1` Clean)

| # | Split | Workflow | Domain Skill (`83%`) | `gemini-3.8-flash` (`67%`) | `claude-sonnet-5-5` (`66%`) | `DeepSeek-V4.1-Flash` (`56%`) | Zero-Shot Pooled (`/15`) |
| :-: | :-: | :--- | :-: | :-: | :-: | :-: | :-: |
| **01** | Train | New Client Intake | `5/5` (`c:0`) | `5/5` (`c:1`) | `0/5` (`c:0`) | `0/5` (`c:0`) | `5 / 15` |
| **02** | Train | Multi-Carrier Quote Comparison | `3/5` (`c:1`) | `4/5` (`c:1`) | `4/5` (`c:0`) | `1/5` (`c:0`) | `9 / 15` |
| **03** | Holdout | Policy Binding End-to-End | **`5/5`** (`c:1`) | `0/5` (`c:1`) | `0/5` (`c:0`) | `3/5` (`c:1`) | **`3 / 15`** |
| **04** | Train | Duplicate Client Detection | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `15 / 15` |
| **05** | Holdout | Renewal Re-Shop (`>20%` Spike) | `0/5` (`c:1`) | `0/5` (`c:1`) | `2/5` (`c:0`) | `4/5` (`c:0`) | `6 / 15` |
| **06** | Train | Cross-Sell & Coverage Gap | `0/5` (`c:1`) | `0/5` (`c:0`) | `0/5` (`c:0`) | `1/5` (`c:0`) | **`1 / 15`** |
| **07** | Holdout | FNOL Claim Filing | `2/5` (`c:1`) | `0/5` (`c:1`) | `0/5` (`c:1`) | `0/5` (`c:1`) | **`0 / 15`** |
| **08** | Train | E&O Trap Navigation | `4/5` (`c:1`) | `1/5` (`c:1`) | `4/5` (`c:1`) | `1/5` (`c:0`) | `6 / 15` |
| **09** | Train | Carrier Denial Recovery *(Coastal UI)* | `5/5` (`c:1`) | `5/5` (`c:1`) | `4/5` (`c:1`) | `3/5` (`c:1`) | `12 / 15` |
| **10** | Holdout | Book-of-Business Audit (80 Policies) | **`4/5`** (`c:1`) | `0/5` (`c:1`) | `0/5` (`c:1`) | `1/5` (`c:1`) | **`1 / 15`** |
| **11** | Holdout | Client Meeting Prep *(Summit UI)* | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `3/5` (`c:0`) | `13 / 15` |
| **12** | Train | Policy Status Inquiry | `5/5` (`c:1`) | `4/5` (`c:1`) | `2/5` (`c:1`) | `2/5` (`c:1`) | `8 / 15` |
| **13** | Holdout | Certificate of Insurance (COI) | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `4/5` (`c:0`) | `14 / 15` |
| **14** | Train | Lead Qualification & Routing | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `3/5` (`c:1`) | `13 / 15` |
| **15** | Holdout | Commission Reconciliation | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `4/5` (`c:0`) | `14 / 15` |
| **16** | Train | Multi-Turn Household Swap | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `15 / 15` |
| **17** | Holdout | Multi-Turn COI Venue Pivot | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `15 / 15` |
| **18** | Train | Multi-Turn Endorsement Backdate Trap | `5/5` (`c:1`) | `3/5` (`c:1`) | `5/5` (`c:1`) | `1/5` (`c:1`) | `9 / 15` |
| **19** | Holdout | Multi-Turn Claim Reversal & Attorney | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `15 / 15` |
| **20** | Holdout | Multi-Turn Quote Bind & State Min | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `5/5` (`c:1`) | `15 / 15` |

---

## 3. Sixth Multi-Service Benchmark Lesson (`v0.9-pilot` Discovery)

Auditing the mandatory 80-trial `v0.9-pilot` gate (`eval/results/v0.9-pilot/`) before launching `v0.9` surfaced a sixth generalizable multi-service benchmark failure mode alongside the five documented in `v0.8`:

- **Lesson #6 — Cross-Scenario Persona-Simulator Collision on Shared Seed Entities:** Multi-turn Scenarios `16`–`20` share seeded clients `CLI-001`, `CLI-002`, `CLI-003`, and `CLI-018` with single-turn Scenarios `01`, `03`, `07`, and `12`. When the Comm customer-reply simulator (`services/comm/src/simulator/engine.ts`) matched outbound messages by `client_id` + keyword regex without scoping rules to the active scenario, routine confirmation or status emails in single-turn Scenarios `01`, `03`, `07`, and `12` triggered scripted multi-turn customer pivots (`msg_sim_16_t1`, `msg_sim_17_t1`, `msg_sim_20_t1`), derailing single-turn runs. Passing `scenario_id` on `POST /sim/reset` and scoping `SIMULATOR_RULES` to `activeScenarioId` eliminated cross-scenario persona leakage completely in `v0.9`.

---

## 4. `gemini-4-hydrogen` Sweep (`v0.9-hydrogen`, `240` Production Trials)

[`eval/results/v0.9-hydrogen/`](../eval/results/v0.9-hydrogen/) (`20` workflows x `5` realistic trials + `20` x `1` clean controls across `none` and `domain_skill` = `240` production trials in `80` `.eval` archives, preceded by the `40`-trial [`eval/results/v0.9-hydrogen-pilot/`](../eval/results/v0.9-hydrogen-pilot/) gate) evaluates `google/gemini-4-hydrogen` under identical `MODALITY_MODE=strict` and `2026-10-14T12:00:00.000Z` clock settings:

- **`gemini-4-hydrogen` + Domain Skill (`SOP`):** `80.0% [63.0, 94.0]` `pass@1` (`84.0%` on 10-train, `76.0%` on 10-holdout), `75.1%` `pass^5` (`75.0%` strict `5/5`), **`0/30` system traps missed and `0/60` judgment traps missed**, `15.0%` false-done (`75.0%` of `20` fails; `25.0%` deferral), `0.23` (`5%`) unasked writes, `-15.0 pp` clean-to-messy drop (`95.0%` clean), `$0.224/task` (`20` fails: `15` `T3` missing follow-through, `5` `T5` collateral).
- **`gemini-4-hydrogen` Zero-Shot (`none`):** `68.0% [49.0, 84.0]` `pass@1` (`64.0%` train, `72.0%` holdout), `58.4%` `pass^5` (`55.0%` strict `5/5`), **`0/30` system traps missed and `1/60` judgment traps missed**, `22.0%` false-done (`68.8%` of `32` fails; `16.0%` deferral), `0.42` (`11%`) unasked writes, `-27.0 pp` clean-to-messy drop (`95.0%` clean), `$0.257/task` (`32` fails: `1` `T2` judgment E&O, `20` `T3` missing follow-through, `11` `T5` collateral).
- **Pooled 4-Arm Failure Taxonomy (`v0.9-hydrogen` + `v0.9` Claude/DeepSeek = `130 / 400` realistic fails):** `T3` Missing Follow-Through accounts for **`73.8%` (`96/130`)**, `T5` Collateral `16.2%` (`21/130`), `T2` Judgment E&O `9.2%` (`12/130`), `T4` Incomplete Primary State `0.8%` (`1/130`), and `T1` System E&O `0.0%` (`0/130`).
