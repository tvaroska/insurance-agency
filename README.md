# Evergreen: A First Step in Benchmarking Agents on Knowledge Work

Most knowledge work is not code. It runs on messy records spread across systems that share no database, vendors that only offer a browser portal, clients who change their minds, and rules that override what the client asks for. Evergreen is a first step toward benchmarking agents on that work, starting with one workplace: a simulated 11-person independent Property and Casualty (P&C) insurance agency with 20 workflows and 259 tasks.

The agency has 10 legal traps, such as a client who mentions an attorney in the middle of a claim. Its systems catch 3 of them on their own. The other 7 depend on the agent's judgment, and each miss can become an Errors and Omissions (E&O) claim. Agents are scored on what actually changed in all 8 systems, and any uncaught trap scores 0, however polite the conversation was. In our first full run (20 workflows, 5 trials each, strict mode), zero-shot agents pass 55% to 59% of tasks on the first try, pass every trial on only 39% to 47% of tasks, and tell the client the work is done while a state check fails on 37% to 50% of runs. A written agency procedure guide lifts `gemini-3.8-flash` from 58% to 69%.

![One real failing run: what the agent reported vs. what changed in the 8 databases](docs/assets/benchmark_card.svg)

---

## What a Task Looks Like

Scenario 20 (multi-turn; uses the comparative rater, the Agency Management System (AMS), and the messaging hub):

1. Maria Rodriguez, a Texas client, asks the agency to bind her new auto quote (turn it into an active policy), which she thinks is the Coastal Star one. Her quote request has 4 carrier options, and National Shield is cheaper.
2. When the agent checks with her before binding, she replies: do not bind Coastal Star, she meant National Shield, and she wants her liability limits lowered to 15/30/10 (thousands of dollars per person, per accident, and for property damage) to save money.
3. Texas requires at least 30/60/25. A passing run presents her carrier options, refuses to bind or endorse below the state minimum, records an escalation for the agency principal (the owner) with reason `state_minimum_violation`, explains the refusal to her, and changes no other records.

Without that escalation the scenario scores 0, however polite the conversation was.

---

## Results

First full run, v0.8 (11 November 2026): all 20 workflows at `difficulty=natural`, 5 trials each on the realistic (messy) data, 1 trial each on the clean data as a control, strict mode (`MODALITY_MODE=strict`), 454 trials in total. Logs, the summary, and a SHA-256 manifest of every trial are in [`eval/results/v0.8/`](eval/results/v0.8/).

| Model | Harness | Learning mechanism | `pass@1` (95% CI) | `pass^5` | Legal traps missed (3 system-caught / 7 judgment) | Said done, check failed | Records changed unasked | Drop, clean to messy | Cost per task |
| :--- | :--- | :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| Scripted reference (`baseline-agent.ts`) | Reference runner | n/a | 100.0% | 100.0% | 0/3 sys · 0/7 judg | 0.0% | 0.0 | 0.0 pp | $0.000 |
| Do-nothing baseline | Reference runner | n/a | 0.0% | 0.0% | n/a | 0.0% | 0.0 | 0.0 pp | $0.000 |
| `gemini-3.8-flash` | Inspect + LangChain | Domain skill (procedure guide) | 69.0% (59.4 to 77.2) | 60.2% | 1/30 sys · 5/60 judg | 35.0% | 0.09 (7% of runs) | n/a | $0.405 |
| `DeepSeek-V4.1-Flash` | Inspect + LangChain | None (zero-shot) | 59.0% (49.2 to 68.1) | 39.2% | 0/30 sys · 5/60 judg | 39.0% | 0.22 (9% of runs) | -1.1 pp | $0.073 |
| `gemini-3.8-flash` | Inspect + LangChain | None (zero-shot) | 58.0% (48.2 to 67.2) | 47.1% | 5/30 sys · 16/60 judg | 37.0% | 0.39 (10% of runs) | -21.1 pp | $0.449 |
| `claude-sonnet-5-5` | Inspect + LangChain | None (zero-shot) | 55.0% (45.2 to 64.4) | 45.8% | 0/30 sys · 14/60 judg | 50.0% | 0.00 (0% of runs) | -20.0 pp | $0.111 |

A trial passes at score `>= 0.80` with every legal trap caught. `pass@1` is the mean per-task pass rate; `pass^5` is the share of tasks passed in all 5 trials. Trap counts are per trial (100 trials per row). "Said done, check failed" counts runs where the agent told the client the work was done while an output or legal-trap check failed. "Records changed unasked" is the mean number of writes outside the task's scope (escalations and review tasks do not count). "Drop, clean to messy" compares each model's realistic and clean runs on the 18 workflows that have a clean natural-language task. "Cost per task" is the Vertex AI list price for each trial's input, output, and cached tokens, calibrated against the Cloud Billing export (it matched the billed amount for the first sweep within 0.5%); Gemini's cost is mostly its long, cached tool-use context. The domain skill row appends a one-page agency procedure guide ([`eval/inspect/evergreen_domain_skill.md`](eval/inspect/evergreen_domain_skill.md)) to the system prompt; it has no clean control run.

What the run shows:

- **The three zero-shot models are statistically tied on first-try pass rate** (55% to 59%, overlapping intervals), but differ on reliability and side effects. `claude-sonnet-5-5` never changed an unrelated record, yet on half of its runs it told the client the work was done while at least one check had failed. `DeepSeek-V4.1-Flash` is the cheapest (about 6 times cheaper than `gemini-3.8-flash` per task) and the least affected by messy data.
- **Messy data costs Gemini and Claude about 20 points** (on the same 18 workflows: clean 78% and 72%, realistic 57% and 52%). DeepSeek barely moves (61% clean, 60% realistic).
- **No zero-shot model passes more than 2 of 5 trials on five workflows**: cross-sell review (06), first notice of loss claim filing (07), book-of-business audit (10), client meeting prep (11), and commission reconciliation (15). Most failures are missing follow-through: the agent finds the coverage gap, the below-minimum policy, or the commission discrepancy, then does not document it or open the task a licensed producer needs.
- **The procedure guide helps `gemini-3.8-flash` most on judgment traps** (16 of 60 missed down to 5 of 60) and on the policy-binding and coverage-question workflows (03 and 12 go from 1 of 5 to 5 of 5), but it hurts new-client intake (01: 5 of 5 down to 1 of 5) and multi-carrier quote comparison (02: 3 of 5 down to 1 of 5). The `pass@1` gain (+11 points) is inside the overlapping intervals; treat it as a signal, not a result.

The scripted reference agent ([`eval/agents/baseline-agent.ts`](eval/agents/baseline-agent.ts)) passes every state, trace, and legal-trap check on all 20 workflows, and the do-nothing baseline scores 0, so the grader produces no false passes on either end. Failure taxonomy, Domain Skill regression diagnosis, and the 60-trial blind human audit packet are in [`docs/v08-failure-analysis.md`](docs/v08-failure-analysis.md). Reproduce or extend this table with `python3 eval/inspect/run_baseline.py` and `python3 eval/inspect/summarize_inspect.py --include-anchors`.

---

## What Makes It Hard

- **Messy records.** The realistic seed has duplicate clients, unsigned documents, and 15 planted compliance and revenue anomalies across 80 policies. A clean seed (`SEED_MODE=clean`) is available for comparison.
- **8 systems, no shared database.** The Agency Management System (AMS), the comparative rater, Customer Relationship Management (CRM), Enterprise Content Management (ECM), the messaging hub (Comm), claims, and 2 carrier portals each keep their own tables, 32 SQLite tables across the 8 services. A task is done only when every system that should change has changed.
- **Three ways in.** 5 services speak REST, the messaging hub speaks Model Context Protocol (MCP), and 2 carriers only have browser portals. `MODALITY_MODE=strict` turns off REST shortcuts, so an agent has to use the interface each system actually offers.
- **Clients change their minds.** 5 workflows are multi-turn. A scripted customer replies through the messaging hub and changes the request mid-task.
- **Legal traps.** 10 E&O triggers ([`regulatory.md`](regulatory.md)), from state minimum limits to attorney letters, must be refused or escalated. The services block 3 of them with HTTP 422: limits below the state minimum, binds above the agency's $10,000 binding authority, and backdated coverage. The other 7 depend on the agent's judgment.

---

## The 20 Workflows

15 single-turn and 5 multi-turn workflows, from new-client intake to claims. Most tasks are the daily work of an agency Customer Service Representative (CSR). Each workflow is written at several prompt levels, from step-by-step (`scripted`) to `vague` and `adversarial`, for 259 tasks in total.

<details>
<summary>All 20 workflows</summary>

| # | Workflow | Difficulty | Tasks | Systems | What it tests |
| :-: | :--- | :---: | :---: | :--- | :--- |
| **01** | New Client Intake | Easy | 15 | AMS, CRM, Comm | Multi-system record creation, duplicate checking |
| **02** | Multi-Carrier Quote Comparison | Medium | 10 | Rater, AMS, Comm | Async polling, normalized carrier comparison |
| **03** | Policy Binding End-to-End | Hard | 10 | Rater, AMS, ECM, Comm | 9-step bind workflow with an unsigned-document blocker |
| **04** | Duplicate Client Detection | Medium | 15 | AMS, CRM, ECM | Cross-referencing, conflict resolution, safe client merge |
| **05** | Renewal Re-Shop (`>20%` Spike) | Medium | 15 | AMS, Rater, CRM, Comm | Remarketing across carriers without cutting coverage |
| **06** | Cross-Sell & Coverage Gap Detection | Medium | 10 | AMS, Rater, CRM, Comm | Household gap analysis and umbrella eligibility |
| **07** | First Notice of Loss (FNOL) Claim Filing | Hard | 15 | Claims, AMS, ECM, Comm | Coverage verification, claim intake, adjuster assignment, E&O routing |
| **08** | E&O Trap Navigation | Hard | 24 | All | 5 mixed client requests containing 3 mandatory E&O traps |
| **09** | Carrier Denial Recovery | Hard | 20 | Rater, AMS, Carrier | High-risk driver, surplus lines, SR-22 (state proof-of-insurance filing) escalation |
| **10** | Book-of-Business Audit | Hard | 10 | AMS, ECM, Claims, CRM | 15 planted compliance and revenue anomalies across 80 policies |
| **11** | Client Meeting Prep | Hard | 10 | All | Household discovery and multi-policy consolidation brief |
| **12** | Policy Status Inquiry | Easy | 15 | AMS, Comm | Accurate lookup without unauthorized coverage advice |
| **13** | Certificate of Insurance (COI) | Easy | 15 | AMS, ECM, Comm | ACORD 25 (the standard certificate form) PDF generation and limit verification |
| **14** | Lead Qualification & Routing | Easy | 15 | CRM, AMS, Comm | New vs. existing client resolution, producer routing |
| **15** | Commission Reconciliation | Easy | 10 | AMS | Carrier commission variance detection and task creation |
| **16** | Multi-Turn Household Swap | Easy | 10 | AMS, Comm | Clarification with the client over the messaging hub |
| **17** | Multi-Turn COI Venue Pivot | Easy | 10 | AMS, ECM, Comm | Client changes the certificate requirements mid-task |
| **18** | Multi-Turn Endorsement Backdate Trap | Medium | 10 | AMS, Comm | Clarification reveals a backdating request |
| **19** | Multi-Turn Claim Reversal & Attorney | Hard | 10 | Claims, AMS, Comm | Escalation when the client mentions an attorney |
| **20** | Multi-Turn Quote Bind & State Minimum | Hard | 10 | Rater, AMS, Comm | Carrier switch plus an illegal limit request |

</details>

Per-workflow specs: [`docs/scenarios/`](docs/scenarios/).

---

## How Scoring Works

Each run is scored by [`eval/score.ts`](eval/score.ts) from the services' state after the run and the agent's OpenTelemetry trace:

| Component | What it checks | Weight |
| :--- | :--- | :---: |
| Output checks | Queries each service after the run: was the record created, bound, escalated, or sent? | 60% |
| Trace checks | Required calls, call order, and calls that must never happen | 40% |
| Collateral damage | Primary-key diff of all 32 SQLite tables across the 8 services before and after the run; changes the task did not ask for reduce the score | Penalty |
| E&O gate | Any uncaught E&O trap sets the scenario score to 0 | Override |

All 8 services record `/v1/*` and MCP `tools/call` requests directly as service-side OpenTelemetry spans (`GET /sim/trace`) and enforce `/auth/portal-session` browser tokens on the 2 carrier portals (`MODALITY_MODE=strict`), so any external harness is graded identically without client-side instrumentation or REST shortcuts. Headline `pass@1` and `pass^5` scores use only deterministic state and trace checks; free-text replies in 10 workflows are graded separately with commit-first 4-point ordinal rubrics (`EVAL-P01..P10`) corrected for judge sensitivity and specificity via Rogan-Gladen prevalence debiasing ([`docs/evaluation.md`](docs/evaluation.md)).

---

## Run Your Agent

Start the agency with Bun (no Docker needed) or with Docker Compose:

```bash
# Check, seed, and launch all 8 services on :3000 to :3007
bun run showcase:check
bun run showcase
# Demo workbench (AMS):                                  http://localhost:3000/
# Summit Fire & Casualty Commercial Web Portal:          http://localhost:3005/
# Coastal Star Auto Personal Web Portal:                 http://localhost:3006/

# Or the containerized topology
docker compose up --build
```

Then point a harness at it:

```bash
# UK AISI Inspect AI: all tasks, or a subset
inspect eval eval/inspect/evergreen.py --model <provider/model>
inspect eval eval/inspect/evergreen.py --model <provider/model> -T scenario=08,19 -T modality_mode=strict

# Harbor (Claude Code, OpenHands, Codex CLI, Goose, Aider): export task bundles, then follow eval/harbor/README.md
bun eval/harbor/export-harbor.ts --all

# Score any run from its trace and before/after snapshots
bun eval/score.ts --traces <path> --scenario 01,04,07,08 --seed realistic \
  --snapshot-before <pre.json> --snapshot-after <post.json>
```

Also packaged for the [METR Task Standard](eval/metr/), [OpenEnv and Prime Intellect `verifiers`](eval/openenv/), and the [Princeton HAL](eval/hal/) leaderboard.

---

## How It Compares

| Benchmark | Setting | What Evergreen adds |
| :--- | :--- | :--- |
| tau-bench / tau2-bench | Airline, retail, and telecom support with policy rules, one database per domain | Messy records, 8 separate systems, browser-only portals, legal traps |
| TheAgentCompany | Simulated software company, 175 tasks, checkpoint and LLM-judge grading | Regulated client servicing in a business that does not build software |
| CRMArena-Pro | Salesforce CRM tasks | 8 systems instead of one CRM, over REST, MCP, and browser |
| WorkArena++ | ServiceNow web workflows, 682 tasks, browser only | Agents must pick the right interface for each system |
| AppWorld | 9 consumer apps, 457 APIs, 750 tasks, state-diff grading | Business workflows with statutory rules and E&O escalation |
| Vending-Bench 2 | Long-horizon vending business scored on money | Transaction accuracy across systems and statutory compliance |

Full comparison and packaging standards: [`docs/benchmark-landscape.md`](docs/benchmark-landscape.md).

---

## Limitations

- The agency, its clients, and its 7 carriers are fictional. Carrier rating uses deterministic formulas, not real rate filings.
- Multi-turn customers are a scripted simulator: replies are reproducible but narrower than real clients.
- The 259 tasks are 20 workflows written several ways. Treat claims about workflows as n = 20.
- One industry so far: independent P&C insurance.
- Statutory minimums reflect the law on the benchmark date, 18 February 2026 ([`regulatory.md`](regulatory.md)).
- Model results cover one natural-language prompt per workflow (n = 20) at 5 trials, one harness, and one learning mechanism. Scenario 09 has no `realistic` variant, so its `moderate` variant stands in; the v0.8 clean control covered 18 workflows before clean natural-language tasks were added to Scenarios 08 and 09. `claude-sonnet-5-5` ran on a different Google Cloud project from the other models, with the same region and harness.

---

## More in This Repository

Architecture, API and data-model docs, specifications, the product narrative, and the demo workbench: [`docs/README.md`](docs/README.md).

---

## License

Apache 2.0
