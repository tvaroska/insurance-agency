# Evergreen Insurance Partners: Executive Brief (`EXECUTIVE-BRIEF.md`)

**One-Line Summary:** Evergreen is a runnable 8-microservice Property and Casualty (P&C) insurance brokerage showcase and 20-scenario (253-task) governance benchmark demonstrating how an 11-person independent agency expands modeled capacity from **$20.0M to $38.5M written premium (`$200K to $385K` revenue/employee, `+92.5%`)** with **100% Errors and Omissions (E&O) trap interception**, **zero unauthorized database mutations**, and **`$0`-token compiled routine servicing**.

---

## 1. Executive KPI Receipt

| Executive Metric | Baseline 11-Person Agency | Governed AI-Enabled Agency | Verified Code / Artifact Receipt |
| :--- | :--- | :--- | :--- |
| **Written Premium Capacity (Modeled)** | `$20.0M` (`~5,000` policies) | **`$38.5M`** (`+92.5%` capacity) | [`eval/evolution-showcase.ts`](eval/evolution-showcase.ts) (`calculateAgencyRoi`) |
| **Commission Revenue (11% Blend, Modeled)** | `$2.20M / yr` | **`$4.24M / yr`** | Interactive ROI Calculator on [`http://localhost:3000/`](services/ams/src/routes/workbench.ts) |
| **Revenue per Employee (11 Staff, Modeled)** | `$200,000 / FTE` | **`$385,000 / FTE`** | [`design/story.md`](design/story.md) & [`docs/executive-scorecard.html`](docs/executive-scorecard.html) |
| **Routine CSR Work Automated** | `0%` (manual re-keying) | **`78%`** (COIs, FNOL, renewals, audits) | `privy:cert-issuer`, `privy:claims-intake`, `privy:renewal-monitor`, `privy:endorsement-guard` |
| **1st-Line Statutory E&O Firewall (Measured)** | Manual CSR memory | **HTTP `422` Hard Service Gate (10 States)** | [`packages/shared/src/compliance-firewall.ts`](packages/shared/src/compliance-firewall.ts) |
| **3rd-Line Database Collateral Audit (Measured)** | Unverified chat logs | **35-Table Pre/Post SQLite State Diff (`0` unauthorized)** | [`eval/evaluators/state-diff.ts`](eval/evaluators/state-diff.ts) |
| **Routine Servicing Token Cost** | `$0.0029 / run` (`6,500` tok) | **`$0.0000 / run`** (`0` tokens in Stage 3) | [`eval/evolution-showcase.ts`](eval/evolution-showcase.ts) (`COMPILED_WORKFLOW_SPECS`) |

---

## 2. Five Runnable Executive Hero Journeys

Launch the Executive Operations & Governance Workbench (`bun run showcase` at `http://localhost:3000/`) to execute all 5 journeys live:

1. **`J1`: 15-Anomaly Book-of-Business Audit (`Scenario 10`):** Scans active policies, documents, claims, and commissions across all 8 services to catch all 15 seeded E&O and revenue anomalies (unsigned ACORD applications, below-minimum state limits, unapplied endorsements, duplicate households, and `>20%` renewal spikes).
2. **`J2`: 60-Second ACORD 25 Certificate of Insurance Issuance (`Scenarios 13 & 17`):** Verifies active Commercial GL limits and endorsements in the Agency Management System (AMS), renders a real multi-field **ACORD 25 PDF** (`application/pdf`, `%PDF-1.7`) via [`services/ecm/src/templates/acord-25.ts`](services/ecm/src/templates/acord-25.ts), and delivers the certificate via the Model Context Protocol (MCP) communications hub (`0` LLM tokens in Stage 3).
3. **`J3`: Multi-Modal Carrier Submission (`Scenarios 09 & 14`):** Quotes commercial and personal risks across REST carriers (*Hartland Commercial*, *Erie Basin Mutual*, *National Shield*) and legacy browser portals (*Summit Fire & Casualty* `:3005`, *Coastal Star Auto* `:3006`), automatically routing binds above the `$10,000` agency threshold to the Principal Escalation Queue.
4. **`J4`: Severe Claims FNOL, CAT Surge & SIU Triage (`Scenarios 07 & 19`):** Verifies coverage on date of loss, files the First Notice of Loss (FNOL) claim on Claims (`:3007`), assigns emergency adjuster priority, and escalates attorney representation notices without admitting liability.
5. **`J5`: Live 1st-Line E&O Trap Interception (`Scenarios 08, 18 & 20`):** Demonstrates deterministic HTTP `422` service-layer rejection when a client requests lowering California auto liability to `10/20/5` (below the `15/30/5` statutory floor) or backdating a deductible reduction prior to a loss.

---

## 3. 3-Stage Agent-to-Code Evolution (`$0`-Token Routine Execution + `FallbackToSkill`)

| Stage | Architecture | Avg Tokens / Run | Est. Cost / Run | Latency | `pass@1` | `pass^5` (5-Trial Reliability) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Stage 1: General Agent** | Zero-shot tool discovery across 8 services | `6,500` | `$0.0029` | `3,900 ms` | `85.0%` | `44.4%` |
| **Stage 2: Domain Skill** | Insurance playbook + 10-state E&O rules + portal sequences | `2,700` | `$0.0012` | `1,650 ms` | `97.0%` | `85.9%` |
| **Stage 3: Compiled Code (`privy:*`)** | Deterministic TypeScript handlers + `FallbackToSkill` on client pivots (`Scenarios 17–20`) | **`0` (routine)** | **`$0.0000`** | **`180 ms`** | **`100.0%`** | **`100.0%`** |

---

## 4. Measured vs. Modeled Provenance & 60-Second Executive Quickstart

> **Measured vs. Modeled Provenance:** All 8 microservices, 35 SQLite tables, 20 scenarios (253 tasks), the HTTP `422` statutory firewall across 10 US states, and `%PDF-1.7` ACORD 25 output are **measured in code** and verified by automated tests. The 11-person agency financials (`$20.0M` to `$38.5M` written premium and `$200,000` to `$385,000` revenue per employee) are **modeled projections** computed by `calculateAgencyRoi` ([`eval/evolution-showcase.ts`](eval/evolution-showcase.ts) / [`landscape.md`](landscape.md)).

```bash
# 1. Preflight check all 8 microservices and Executive Workbench
bun run showcase:check

# 2. Launch all 8 services + Executive Workbench on http://localhost:3000/
bun run showcase

# 3. Generate the self-contained Executive HTML Scorecard
bun eval/score.ts --html-out docs/executive-scorecard.html
```
