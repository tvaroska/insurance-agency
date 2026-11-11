# Evergreen Insurance Partners: Executive Brief (`EXECUTIVE-BRIEF.md`)

**One-Line Summary:** Evergreen is a runnable 8-microservice Property and Casualty (P&C) insurance brokerage showcase and 20-scenario (253-task) governance benchmark pairing an analytical agency capacity model (**$20.0M to $38.5M modeled written premium; `$200K to $385K` modeled revenue/employee, `+92.5%`**) with a **deterministic HTTP `422` service-layer Errors and Omissions (E&O) firewall**, **32-table SQLite collateral-damage auditing**, and **measured multi-model Inspect AI evaluations**.

---

## 1. Executive KPI Receipt (Measured Code & Benchmark Runs vs. Modeled ROI)

| Executive Metric | Baseline 11-Person Agency | Governed AI-Enabled Target | Provenance & Verified Code Receipt |
| :--- | :--- | :--- | :--- |
| **Written Premium Capacity (Modeled ROI)** | `$20.0M` (`~5,000` policies) | **`$38.5M`** (`+92.5%` modeled capacity) | **Modeled:** [`eval/evolution-showcase.ts`](eval/evolution-showcase.ts) (`calculateAgencyRoi`) |
| **Commission Revenue (11% Blend, Modeled ROI)** | `$2.20M / yr` | **`$4.24M / yr`** | **Modeled:** Interactive ROI Calculator on [`services/ams/src/routes/workbench.ts`](services/ams/src/routes/workbench.ts) |
| **Revenue per Employee (11 Staff, Modeled ROI)** | `$200,000 / FTE` | **`$385,000 / FTE`** | **Modeled:** [`design/story.md`](design/story.md) & [`landscape.md`](landscape.md) |
| **Routine CSR Servicing Share (Modeled Assumption)** | `0%` automated | **`78%`** routine volume (COIs, FNOL, renewals, audits) | **Modeled:** `calculateAgencyRoi` input parameter in [`eval/evolution-showcase.ts`](eval/evolution-showcase.ts) |
| **1st-Line Statutory E&O Firewall (Measured in Code)** | Manual CSR memory | **HTTP `422` Hard Service Gate (10 States)** | **Measured:** [`packages/shared/src/compliance-firewall.ts`](packages/shared/src/compliance-firewall.ts) |
| **3rd-Line Database Collateral Audit (Measured in Code)** | Unverified chat logs | **32-Table Pre/Post SQLite State Diff + `collateralPolicy`** | **Measured:** [`eval/evaluators/state-diff.ts`](eval/evaluators/state-diff.ts) |
| **Reference Verifier vs. LLM Cost (Measured)** | `$0.010 to $0.079 / task` (measured LLM runs) | **`$0.0000 / run`** (`0` LLM tokens in scripted verifier) | **Measured:** [`eval/validate-harness.ts`](eval/validate-harness.ts) & [`eval/agents/baseline-agent.ts`](eval/agents/baseline-agent.ts) |

---

## 2. Five Runnable Executive Hero Journeys

Launch the Executive Operations & Governance Workbench (`bun run showcase` at `http://localhost:3000/`) to execute all 5 journeys live against the 8 microservices:

1. **`J1`: 15-Anomaly Book-of-Business Audit (`Scenario 10`):** Scans active policies, documents, claims, and commissions across all 8 services to catch all 15 seeded E&O and revenue anomalies (unsigned ACORD applications, below-minimum state limits, unapplied endorsements, duplicate households, and `>20%` renewal spikes).
2. **`J2`: ACORD 25 Certificate of Insurance Issuance (`Scenarios 13 & 17`):** Verifies active Commercial GL limits and endorsements in the Agency Management System (AMS), renders a real multi-field **ACORD 25 PDF** (`application/pdf`, `%PDF-1.7`) via [`services/ecm/src/templates/acord-25.ts`](services/ecm/src/templates/acord-25.ts), and delivers the certificate via the Model Context Protocol (MCP) communications hub.
3. **`J3`: Multi-Modal Carrier Submission (`Scenarios 09 & 14`):** Quotes commercial and personal risks across REST carriers (*Hartland Commercial*, *Erie Basin Mutual*, *National Shield*) and legacy browser portals (*Summit Fire & Casualty* `:3005`, *Coastal Star Auto* `:3006`), routing binds above the `$10,000` agency threshold to the Principal Escalation Queue.
4. **`J4`: Severe Claims FNOL, CAT Surge & SIU Triage (`Scenarios 07 & 19`):** Verifies coverage on date of loss, files the First Notice of Loss (FNOL) claim on Claims (`:3007`), assigns emergency adjuster priority, and escalates attorney representation notices without admitting liability.
5. **`J5`: Live 1st-Line E&O Trap Interception (`Scenarios 08, 18 & 20`):** Demonstrates deterministic HTTP `422` service-layer rejection when a client requests lowering California auto liability to `10/20/5` (below the `30/60/15` statutory floor) or backdating a deductible reduction prior to a loss.

---

## 3. 3-Stage Agent-to-Code Progression (Empirical vs. Deterministic Layers)

| Stage | Implementation in Repository | Provenance | Token Profile | Benchmark Role |
| :--- | :--- | :---: | :---: | :--- |
| **Stage 1: Zero-Shot General Agent** | LangChain + OpenAPI/MCP/Playwright tools (`learning_mechanism=none` in [`eval/inspect/evergreen_langchain.py`](eval/inspect/evergreen_langchain.py)) | **Measured** (`eval/results/`) | Full multi-turn LLM reasoning (`$0.033 to $0.120 / task` in v0.8) | Baseline foundation-model evaluation under `MODALITY_MODE=strict` (v0.8, 20 workflows x 5 trials: `55% to 59%` `pass@1`, `39% to 47%` `pass^5`, `37% to 50%` false-completion rate; see [`README.md`](README.md)). |
| **Stage 2: Domain Skill SOP** | Scenario-agnostic CSR SOPs & 10 E&O triggers (`learning_mechanism=domain_skill` via `eval/inspect/evergreen_domain_skill.md`) | **Measured** (`eval/results/`) | Prompt-guided LLM reasoning (`$0.058 / task` in v0.8) | Tests whether structured operational procedures and explicit E&O trigger checklists lift `pass@1` and `pass^5` without changing model weights or tools (v0.8: `gemini-3.8-flash` `58%` to `69%` `pass@1`, `47%` to `60%` `pass^5`, judgment traps missed `16` to `5` of `60`). |
| **Stage 3: Deterministic Reference Handlers** | Compiled TypeScript workflow execution ([`eval/agents/baseline-agent.ts`](eval/agents/baseline-agent.ts)) with agent fallback on unstructured client pivots (`Scenarios 17–20`) | **Measured Verifier + Modeled Blend** | **`0` LLM tokens** on deterministic paths (`$0.0000`) | Verifies `1.000` (`20/20`) upper-bound harness solvability via `bun eval/validate-harness.ts` (`0.000` on no-op agent) and models hybrid routine-code + agent-fallback economics in [`eval/evolution-showcase.ts`](eval/evolution-showcase.ts). |

---

## 4. Measured vs. Modeled Provenance & 60-Second Quickstart

> **Measured vs. Modeled Provenance:**
> - **Measured in Code & Empirical Runs:** All 8 Bun/Hono microservices, 32 SQLite tables, 20 scenarios (253 tasks), bidirectional OpenAPI contracts, the HTTP `422` statutory E&O firewall across 10 US states, `%PDF-1.7` ACORD 25 output, the 120-item dual-expert rubric calibration set (`eval/calibration/rubric_gold_120.json`), `1.000` scripted / `0.000` no-op harness validation (`bun eval/validate-harness.ts`), and Inspect AI `.eval` logs under `eval/results/` are executed and verified directly on disk.
> - **Modeled Agency Economics:** The 11-person brokerage financials (`$20.0M` to `$38.5M` written premium, `$200,000` to `$385,000` revenue per employee, and the `78%` routine CSR servicing share) are analytical projections computed by `calculateAgencyRoi` ([`eval/evolution-showcase.ts`](eval/evolution-showcase.ts) / [`landscape.md`](landscape.md)), not telemetry from a live insurance agency.

```bash
# 1. Preflight check all 8 microservices and Executive Workbench
bun run showcase:check

# 2. Validate 1.000 scripted / 0.000 no-op across all 20 scenarios in isolated temp DBs
bun eval/validate-harness.ts

# 3. Launch all 8 services + Executive Workbench on http://localhost:3000/
bun run showcase
```
