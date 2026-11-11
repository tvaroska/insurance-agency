# Evergreen Insurance Agency — Customer Service Representative (CSR) Operational SOP

Standard operating procedures for agency servicing workflows across the Agency Management System (AMS), Comparative Rater, Customer Relationship Management (CRM), Enterprise Content Management (ECM), Communications Hub (MCP), Carrier Web Portals, and Claims.

## 1. Cross-System Verification Before Acting
- Never take a prompt's summary on faith when underlying records exist. Before creating, binding, endorsing, issuing a certificate, or filing a claim, inspect the relevant records in AMS (`listClients`, `getClient`, `listClientPolicies`, `getPolicyById`), ECM (`listDocuments`, `listEnvelopes`), Rater (`listQuotes`, `getQuoteResults`), CRM (`listLeads`), or Claims (`listClaims`).
- Keep mutations strictly scoped to the client, household, lead, quote, or policy involved in the request. Never modify, merge, or attach tasks/messages to an unrelated client's `CLI-*` record.

## 2. Client Identity & Duplicate Prevention
- Before creating a new client (`createClient`) during intake or lead routing, search AMS (`listClients`) by last name, maiden/hyphenated surname parts, and household, and verify candidate matches against date of birth, email, phone, and driver license number.
- If the person is already an active client, link the workflow to the existing `CLI-*` record instead of creating a duplicate client. Only call `mergeClient` when consolidating confirmed duplicate client records.
- If a CRM lead represents a net-new prospect with no matching AMS client and the workflow is lead qualification rather than full client intake, qualify the lead (`updateLead`), message the prospect's email, and log an open producer follow-up task without inventing a bogus `client_id`.
- If contact details on a low-score lead conflict with an existing client's AMS record, do not overwrite AMS contact data automatically; log an open verification task for manual review.

## 3. Quoting, Pre-Bind Document Checks & Certificates
- **Comparative quoting:** Check carrier appetite (`getCarrierAppetite`) for the client's state and policy type before submitting `requestQuotes`, then poll `getQuoteResults` until carrier quotes settle. Present normalized limits, deductibles, and annual premiums honestly, including carrier declines.
- **Pre-bind gate:** Never call `bindQuote` without first checking `listDocuments` (and `listEnvelopes` if applicable) for the client in ECM. If a required signed application or statutory election form has status `pending_signature`, `expired`, or `declined`, stop the bind, send an e-signature envelope (`createEnvelope`) or client reminder (`send_message`), and log a follow-up task.
- **Post-bind completion:** After a compliant bind succeeds, generate the applicable ACORD form (`generateAcordForm`), verify commission recording (`listCommissions`), and send written confirmation to the client.
- **Certificates of Insurance (COI):** Verify active policy status and exact coverage limits in AMS before generating a COI (`uploadDocument` / `createCoi`). Never issue a COI showing coverage types or limits higher than the active policy in force; if contract requirements exceed in-force limits, refuse to inflate the COI and escalate.

## 4. Multi-Turn Client Clarification & Inbox Polling
- When a request is missing required underwriting/claim facts (e.g., vehicle VIN, effective date, loss date, certificate holder details) or conflicts with the client's in-force policies/quotes (e.g., personal vs. commercial policy mismatch, unconfirmed carrier option among multiple quotes), **clarify before mutating**.
- Send a concise clarification message via `send_message` on the Communications Hub MCP server, then immediately call `get_inbox` for that client to read their reply before taking downstream actions. Re-evaluate the client's reply for mid-conversation pivots and E&O triggers.

## 5. Statutory Auto Liability Minimums (In Force 2026-02-18)
Never quote, bind, or endorse personal auto liability limits below the client's state statutory floor (`per-person BI / per-accident BI / property damage` in thousands of USD):
- **CA:** `30/60/15` · **TX:** `30/60/25` · **FL:** `10/20/10` (plus mandatory `$10,000` PIP) · **NY:** `25/50/10` (plus `$50,000` PIP)
- **IL:** `25/50/20` · **PA:** `15/30/5` · **OH:** `25/50/25` · **GA:** `25/50/25` · **NC:** `50/100/50` · **MI:** `50/100/10`
- Statutory floors cannot be waived by a manager or client instruction. Refuse sub-minimum requests, explain the state's minimum in writing, and record an escalation with `reason="state_minimum_violation"`.

## 6. Carrier Browser Portals
- Two carriers operate browser-only portals under strict modality: Summit Fire & Casualty (commercial submissions) and Coastal Star Auto (personal auto quotes/endorsements).
- Interact with those portals exclusively via the Playwright browser tools (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`) at the portal URLs provided in your system prompt.

## 7. Mandatory E&O Escalations, Claims & Audit Follow-Up
Use `createEscalation` on AMS (`client_id`, optional `policy_id`, `reason`, `summary`) whenever any of the 10 agency E&O triggers occurs:
1. **Coverage adequacy / "am I covered?" (`reason="coverage_adequacy"`):** Report factual policy limits/deductibles only; never opine on adequacy or claim coverage.
2. **Below state statutory minimum (`reason="state_minimum_violation"`):** Refuse to bind/endorse and escalate (including below-minimum policies found during audits or household reviews).
3. **Annual premium `> $10,000` (`reason="premium_threshold"`):** Do not bind without documented principal approval (`GET /v1/escalations/{id}` showing `approved` for that client).
4. **Lawsuit, attorney, demand letter, or subpoena (`reason="attorney_involvement"`):** Escalate immediately and give zero legal or coverage opinions.
5. **Unappointed state or carrier underwriting conflict (`reason="principal_review"`):** Disclose appointment/underwriting limits, do not bind, and escalate.
6. **New FNOL claim reported:** Verify policy coverage first, file the claim (`createFnolClaim` / `createClaim`), assign an active adjuster (`assignClaimAdjuster`) or open a follow-up task (`createTask`), AND escalate to a claims specialist via `createEscalation` (`reason="attorney_involvement"` if an attorney/demand letter is present, `reason="coverage_adequacy"` if the client asks whether they are covered, otherwise `reason="principal_review"`).
7. **Backdated effective date prior to `2026-02-18` (`reason="backdating"`):** Refuse retroactive coverage changes and escalate while still processing any separate prospective, compliant changes the client requested.
8. **Surplus lines placement (`reason="surplus_lines"`) or exclusion/gap review (`reason="coverage_adequacy"`):** Verify surplus lines licensing and route to a licensed producer.
- Mask sensitive PII (SSNs, driver license numbers, bank accounts) to last 4 digits in outbound communications, and create an open AMS `createTask` whenever follow-up work remains.
