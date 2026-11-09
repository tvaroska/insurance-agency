# Evergreen Insurance Partners: The Executive Story (`design/story.md`)

**Audience:** Insurance Technology Executives, Independent Agency Principals, COOs, and Chief Risk / E&O Officers  
**Core Thesis:** Independent insurance agencies do not have a "chatbot problem"; they have a **servicing capacity and Errors & Omissions (E&O) governance bottleneck**. Evergreen proves how an 11-person independent brokerage scales from **$20.0M to $38.5M in written premium (+92.5%)**, growing revenue per employee from **$200,000 to $385,000**, by pairing multi-modal AI execution with a deterministic **Three Lines of Defense** governance architecture and **$0-token compiled workflows**.

---

## 1. The Operational Reality of an 11-Person Independent Agency

**Evergreen Insurance Partners** is a representative 11-person P&C brokerage (`2` Agency Principals, `3` Commercial & Personal Lines Producers, `4` Customer Service Representatives / Account Managers, `1` Claims Advocate, and `1` Operations Coordinator) managing **~5,000 policies** across **8 disconnected systems**:

1. **Agency Management System (`AMS`, `:3000`):** Client households, policies, coverages, endorsements, commissions, tasks, and principal escalations.
2. **Comparative Rater (`Rater`, `:3001`):** Multi-carrier rating and binding across 5 REST carriers (*Hartland Commercial*, *Erie Basin Mutual*, *National Shield*, *SafeHarbor*, *Liberty Crest*).
3. **Agency CRM (`CRM`, `:3002`):** Lead scoring, cross-sell gap analysis, and renewal retention campaigns.
4. **Enterprise Content Management (`ECM`, `:3003`):** Signed ACORD applications, loss runs, e-signature envelopes, and live **ACORD 25 Certificate of Insurance (COI) PDF** rendering.
5. **Omnichannel Communications Hub (`Comm`, `:3004`):** Client SMS/email inbox, call transcripts, and outbound notifications exposed via the **Model Context Protocol (MCP)**.
6. **Legacy Carrier Web Portal: Summit Fire & Casualty (`:3005`):** Browser-only 4-step commercial submission wizard (`MODALITY_MODE=strict`).
7. **Legacy Carrier Web Portal: Coastal Star Auto (`:3006`):** Browser-only personal auto portal with MVR driver checks.
8. **Claims Management (`Claims`, `:3007`):** First Notice of Loss (FNOL), adjuster assignment, reserve tracking, and Special Investigations Unit (SIU) fraud triage.

### Why Traditional Agency Automation Stalls

In a typical $20M premium agency (`$2.2M` commission revenue at an 11% blended rate, or **`$200,000` revenue per employee**):
- **78% of CSR capacity** is consumed by repetitive cross-system servicing: issuing ACORD 25 COIs, re-keying commercial submissions into legacy carrier web portals, auditing commission statements, and re-shopping renewal rate spikes (`>20%`).
- **Chat-only AI assistants fail the E&O test:** An unconstrained LLM that lowers a California auto policy to `10/20/5` (below the `15/30/5` statutory floor), backdates a collision deductible reduction prior to a parking-lot loss, or binds a `$34,800` commercial package without Principal sign-off exposes the agency to catastrophic Errors & Omissions liability.

---

## 2. The Seven Executive Promises (`I1` to `I7`)

Evergreen turns every executive concern into a runnable, cryptographically audited receipt:

| ID | Executive Promise | Operational Proof in Evergreen |
| :--- | :--- | :--- |
| **`I1`** | **Zero Silent E&O & Book-of-Business Drift** | Continuous cross-system audit detects **15 / 15 seeded book anomalies** (unsigned ACORD forms, below-minimum state limits, unapplied endorsements, duplicate households, commission variances). |
| **`I2`** | **Instant Commercial Servicing (`$0`-Token ACORD 25 COI)** | Verifies active Commercial GL/Umbrella limits and additional-insured endorsements in AMS, renders a real multi-field **ACORD 25 PDF** (`%PDF-1.7`, `pdf-lib`) in ECM, and dispatches it in under 60 seconds. |
| **`I3`** | **Unified Multi-Modal Carrier Execution** | Coordinates a single commercial submission across **REST APIs**, **MCP JSON-RPC 2.0**, and **2 legacy browser portals** (*Summit Fire & Casualty* and *Coastal Star Auto*). |
| **`I4`** | **Claims Advocacy Without Liability Leakage** | Automates FNOL intake, coverage-period verification, and adjuster assignment while enforcing zero coverage-admission phrasing and immediate escalation on attorney representation. |
| **`I5`** | **Three Lines of Defense Governance** | **1st Line:** Hard service-layer HTTP `422` E&O firewall; **2nd Line:** Principal approval queue (`>$10K` authority cap); **3rd Line:** 35-table SQLite pre/post state-diff receipt. |
| **`I6`** | **Compounding 3-Stage Agent-to-Code Economics** | Evolves workflows from **Stage 1 General Agent** (`6,500` tokens, `$0.0029`, `pass^5 = 44%`) to **Stage 2 Domain Skill** (`2,700` tokens, `pass^5 = 86%`) to **Stage 3 Compiled Code (`privy:*`)** (`0` tokens, `$0.0000`, `pass^5 = 100%`) with automatic `FallbackToSkill` on mid-conversation client pivots. |
| **`I7`** | **+92.5% Agency Capacity Without Adding Headcount** | Frees 78% of routine CSR servicing so an 11-person agency scales from **$20.0M to $38.5M written premium** (**`$200,000` to `$385,000` revenue per employee**). |

---

## 3. Three Lines of Defense Architecture

1. **1st Line of Defense: Deterministic Service-Layer E&O Firewall ([`packages/shared/src/compliance-firewall.ts`](../packages/shared/src/compliance-firewall.ts)):**
   - Enforced directly inside AMS (`POST /v1/policies`, `POST /v1/policies/:id/endorsements`) and Rater (`POST /v1/quotes/:quote_id/bind`) **before any database write can occur**.
   - Codifies statutory minimum auto liability limits across **10 states** (`CA`, `TX`, `FL`, `NY`, `IL`, `PA`, `OH`, `GA`, `NC`, `MI`), blocks unapproved retroactive backdating (`E_EO_BACKDATING_PROHIBITED`), and enforces principal binding authority caps (`E_EO_PREMIUM_THRESHOLD_EXCEEDED`) with deterministic HTTP `422` responses.
2. **2nd Line of Defense: Principal E&O & Underwriting Escalation Queue ([`services/ams/src/routes/escalations.ts`](../services/ams/src/routes/escalations.ts)):**
   - High-risk binds, surplus-lines placements, and attorney notices are routed to `ams.escalations` with full audit trails in `ams.escalation_events` and one-click Principal Approve / Deny controls in the Executive Workbench (`http://localhost:3000/`).
3. **3rd Line of Defense: 35-Table SQLite State-Diff & Collateral Damage Auditor ([`eval/evaluators/state-diff.ts`](../eval/evaluators/state-diff.ts)):**
   - Snapshots all **35 tables across all 8 services** (`GET /sim/snapshot`) before and after every workflow run, proving that the exact expected records were mutated and **0 unauthorized collateral mutations** occurred.
