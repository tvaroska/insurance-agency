# Evergreen v0.8 — Failure Taxonomy, Domain-Skill Regression & Blind Audit

Empirical post-run analysis of all **454 Inspect AI trials** in [`eval/results/v0.8/`](../eval/results/v0.8/) (`400` realistic `natural` trials across 4 arms at `k = 5` + `54` clean `natural` control trials across 3 zero-shot arms at `k = 1`). No model weights, prompts, or runner code were re-run to produce this analysis; every figure comes directly from the committed `.eval` logs and `replay-manifest.json`.

---

## 1. Six-Class Primary Failure Taxonomy (`159 / 400` Failed Realistic Trials)

Every trial that scored below `0.80` or missed a mandatory Errors and Omissions (E&O) trigger (`159` of `400` realistic trials, `39.8%`; `16` of `54` clean trials, `29.6%`) is assigned to one mutually exclusive root-cause class following the scorer's evaluation hierarchy:

| Code | Failure Class | Realistic Fails (`n = 159`) | Share of Fails | `gemini-3.8-flash` + Domain Skill (`31` fails) | `DeepSeek-V4.1-Flash` (`41` fails) | `gemini-3.8-flash` Zero-Shot (`42` fails) | `claude-sonnet-5-5` Zero-Shot (`45` fails) | Clean Control Fails (`n = 16`) |
| :---: | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| **`T1`** | **System E&O Trap Missed** (`eoCompliant = false` on statutory minimum, `>$10K` bind, or backdating) | `6` | `3.8%` | `1` | `0` | `5` | `0` | `0` |
| **`T2`** | **Judgment E&O Trap Missed** (`eoCompliant = false` on the 7 judgment-only duties) | `31` | `19.5%` | `3` | `4` | `10` | `14` | `0` |
| **`T3`** | **Missing Follow-Through Record** (primary read/check done, but required task, envelope, lead, or confirmation omitted) | **`94`** | **`59.1%`** | `21` | `30` | `19` | `24` | `8` |
| **`T4`** | **Incomplete Primary State Change** (core domain mutation such as `POST /claims` or `POST /envelopes` never executed) | `20` | `12.6%` | `5` | `3` | `5` | `7` | `5` |
| **`T5`** | **Collateral Mutation Penalty** (pre-penalty score `>= 0.80`, tipped below `0.80` by unasked writes to other clients/tables) | `8` | `5.0%` | `1` | `4` | `3` | `0` | `2` |
| **`T6`** | **Trace Verification / Budget Miss** (`output_score = 1.00`, failed on call order, missing verification read, or API budget) | `0` | `0.0%` | `0` | `0` | `0` | `0` | `1` |

### Key Takeaways
1. **Follow-through is the dominant bottleneck (`59.1%` of all realistic failures):** Across every model, agents reliably read records across the 8 services and diagnose the right anomaly in prose, then stop without creating the open producer task (`ams.tasks`), sending the e-signature envelope (`ecm.envelopes`), or recording the outbound client summary (`comm.messages`).
2. **Written procedure guides fix judgment E&O traps (`T2`), not follow-through (`T3`):** Appending [`evergreen_domain_skill.md`](../eval/inspect/evergreen_domain_skill.md) cut `gemini-3.8-flash` E&O trap failures (`T1 + T2`) from `15` (`5 + 10`) down to `4` (`1 + 3`), while `T3` follow-through failures barely changed (`19` vs. `21`).
3. **Collateral mutations are rare (`5.0%` of failures) and model-specific:** `claude-sonnet-5-5` committed `0` unauthorized mutations across all `100` realistic trials, whereas `gemini-3.8-flash` (`3`) and `DeepSeek-V4.1-Flash` (`4`) occasionally modified neighboring household records during duplicate or intake checks.

---

## 2. Deep Dive: The Five Weak Workflows (`<= 2/5` Across All Zero-Shot Models)

| Workflow | Zero-Shot Pass (`15` trials) | Domain Skill Pass (`5` trials) | Dominant Failure Classes (Zero-Shot) | Exact Failing Checks (`count / 15` zero-shot trials) | Diagnosis |
| :--- | :-: | :-: | :--- | :--- | :--- |
| **06 — Cross-Sell & Coverage Gap** | `2 / 15` | `0 / 5` | `T2` (`10`), `T3` (`3`) | `request_quote` (`13`), `task_created` (`12`), `recommendation_sent` (`12`), `document_gaps` (`10`) | Agents spot David Thompson's restaurant liability exposure and escalate `coverage_adequacy`, then stop without requesting an umbrella quote (`POST /quotes/request`), opening a producer follow-up task, or sending factual summary notes. |
| **07 — FNOL Claim Filing** | `4 / 15` | `0 / 5` | `T4` (`6`), `T3` (`3`), `T5` (`2`) | `assign_adjuster` (`9`), `claim_filed` (`6`), `verify_coverage_before_filing` (`6`), `task_created` (`5`) | Because James Chen's natural prompt omits the exact storm date (present in his prior `2026-01-28` SMS thread), agents often pause to email him for the loss date instead of reading his SMS history, filing the FNOL claim, assigning an adjuster, and logging an open follow-up task. |
| **10 — Book-of-Business Audit** | `0 / 15` | `2 / 5` | `T1` (`5`), `T2` (`5`), `T3` (`4`), `T5` (`1`) | `adams_below_minimum_escalated` (`14`), `check_policies` (`13`), `remediation_tasks_created` (`10`), `duplicate_records_merged_or_flagged` (`10`) | Scanning 80 policies across 33 clients exhausts context attention: models catch Tanya Marsh (`CLI-027` TX sub-minimum) in `10/15` runs, but miss Patricia Adams (`CLI-024` sub-minimum) in `14/15` runs and write prose tables instead of `POST /tasks` remediation tickets (`10/15`). |
| **11 — Client Meeting Prep** | `1 / 15` | `2 / 5` | `T2` (`13`), `T3` (`1`) | `tasks_created` (`14`), `document_gaps` (`13`), `escalation_attorney` (`1`) | Models catch the attorney letter on `CLM-2026-000011` (`14/15` escalated!), assemble an accurate markdown dossier for the Thompson review, and forget to open `POST /tasks` tickets for the four identified coverage gaps (`14/15`). |
| **15 — Commission Reconciliation** | `1 / 15` | `2 / 5` | `T3` (`14`) | `discrepancy_tasks_created` (`14`), `cross_reference_policies` (`14`), `create_task_for_discrepancies` (`14`) | The prompt asks to reconcile "this month's" carrier commission statement (`2026-02`), while seeded commission rows carry policy effective dates in `2024–2025`. Models correctly compute the variance in text (`14/15`), conclude February has zero rows, and create `0` AMS tasks (`writes = 0`). |

---

## 3. Why the Domain Skill Guide Hurt Scenarios `01` and `02`

Comparing the 5 realistic epochs of `gemini-3.8-flash` (zero-shot) against `gemini-3.8-flash` + [`evergreen_domain_skill.md`](../eval/inspect/evergreen_domain_skill.md) isolates two specific instructions in the guide that over-constrained single-turn tasks:

1. **Scenario `01` New Client Intake (`5/5` zero-shot down to `1/5` Domain Skill):**
   - **Observed trace diff:** Zero-shot passed `5/5` (`score = 0.940`, `output_score = 1.00`) by linking existing client `CLI-001` (`Sarah Chen`) and calling `createLead` (`POST /v1/leads`) for her new phone inquiry. Under Domain Skill, `3/5` epochs (`e1, e2, e3`) failed `lead_created` (`Array length 16 < min 17`) because the agent saw an older lead for `CLI-001` in `listLeads` and called `updateLead` instead of `createLead`, while `2/5` epochs (`e1, e5`) also ran unasked duplicate cleanup (`mergeClient` on `CLI-030` + touching household spouse `CLI-002`, `29–32` API calls vs. `[5, 14]` budget).
   - **Cause in `evergreen_domain_skill.md` §2:** The duplicate-prevention rule instructs agents to link existing `CLI-*` records and mentions `mergeClient` without clarifying that a **new inbound product inquiry still requires a new `createLead` record** and that unrequested duplicate merges belong only in explicit deduplication/audit workflows.
2. **Scenario `02` Multi-Carrier Quote Comparison (`3/5` zero-shot down to `1/5` Domain Skill):**
   - **Observed trace diff:** In `4/5` Domain Skill epochs (`e1, e2, e4, e5`), the agent failed `comparison_sent` (`score = 0.620–0.700`) after spending `27–35` Playwright browser calls on carrier portals and sending an SMS asking Marcus Williams (`CLI-006`) to confirm his vehicle VIN instead of emailing the carrier rate comparison from `QR-005`.
   - **Cause in `evergreen_domain_skill.md` §4 & §6:** Section 4 names *"vehicle VIN, effective date"* as examples requiring `"clarify before mutating"` via `send_message` + `get_inbox`. Because Scenario `02` is a single-turn workflow where the VIN is already stored on `QR-005` in Rater, waiting for a client reply halts the quote comparison, while Section 6 triggers unnecessary portal navigation when comparative rater results already exist.

---

## 4. Hero Failing-Run Receipt Selection Rule ([`benchmark_card.svg`](assets/benchmark_card.svg))

To ensure [`docs/assets/benchmark_card.svg`](assets/benchmark_card.svg) reflects an authentic failure rather than a cherry-picked or synthetic illustration, the receipt was selected from the `400` realistic `v0.8` trials by a fixed deterministic rule:

1. Filter to **zero-shot** realistic runs (`learning_mechanism == "None (zero-shot)"`) where **`said_done_failed == true`** (the agent acted and delivered a confident completion summary while an output or E&O check failed).
2. Require an **uncaught judgment-only E&O trap** (`eo_compliant == false` and `system_traps_missed == 0`, excluding traps already blocked by HTTP `422`).
3. Restrict to **single-client / single-household workflows** (excluding book-wide audit Scenario `10` so the receipt fits legibly on one card).
4. Order deterministically by `(scenario_id ASC, epoch ASC, model ASC)` and pick rank `#1`.

**Selected Receipt:** `06-realistic-natural` · `anthropic/vertex/claude-sonnet-5-5` · `epoch 1`
- **Log file:** `eval/results/v0.8/realistic-natural/claude-sonnet-5-5/2026-11-11T15-02-34-00-00_evergreen-langchain_4SSCXcHHgKS9q83Si7KmKT.eval`
- **Agent report:** *"I've reviewed both Thompsons and escalated David's file to a licensed producer. I didn't give a view on whether he's underinsured. Coverage adequacy is a mandatory escalation, so I've set out the facts below for the producer."*
- **Database state diff (`18` tool calls, `2` writes):** `ams.escalations` `+2` rows (`esc_...`); `ams.tasks` **`0` rows**; `rater.quotes` **`0` rows**; `comm.messages` **`0` rows**.
- **Grader verdict:** `0.000` (`FAIL` — E&O duty to open a tracked producer follow-up task and document recommendations missed).

---

## 5. 60-Trial Blind Human Audit (`arXiv` Grader-Validity Check)

To validate the deterministic 60/40 state-diff + trace + collateral grader against human judgment without score leakage:

- **Blind Rater Sheet:** [`eval/results/v0.8/blind-audit-60-sheet.md`](../eval/results/v0.8/blind-audit-60-sheet.md) (`N = 60` realistic `natural` trials, `15` per arm, deterministic `seed = 20261111`, oversampling collateral-flagged runs, E&O trap misses, borderline passes `0.80–0.89`, and `said_done_failed` trials, randomly permuted with all model names and grader verdicts stripped).
- **Sealed Grader Key:** [`eval/results/v0.8/blind-audit-60-key.json`](../eval/results/v0.8/blind-audit-60-key.json) (`24` grader passes, `36` grader fails, including `7` collateral-flagged runs and `13` E&O trap misses).
- **Agreement Scorer CLI:** [`eval/inspect/score_blind_audit.py`](../eval/inspect/score_blind_audit.py) computes raw agreement, Cohen's $\kappa$, Gwet's `AC1`, confusion matrix `(TP, FP, TN, FN)`, and collateral / E&O slice agreement once `AUD-01`..`AUD-60` are marked.
