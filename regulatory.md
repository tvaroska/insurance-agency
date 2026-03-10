# Evergreen Insurance Partners — Regulatory & Compliance Rules

**Effective Date:** 2026-02-18
**Last Reviewed:** 2026-02-18
**Applies To:** All AI agents, human producers, and support staff operating within the Evergreen Insurance Partners training environment.

---

## 1. PII Handling Rules

### Fields Classified as PII

| Field | Classification | Masking Rule |
|---|---|---|
| Social Security Number (SSN) | Sensitive PII | Show last 4 digits only: `***-**-1234` |
| Driver's License Number (DL) | Sensitive PII | Show last 4 digits only: `****1234` |
| Date of Birth (DOB) | PII | Never display in logs or traces |
| Bank Account Numbers | Sensitive PII | Show last 4 digits only: `****5678` |
| Email Addresses | PII | Mask as `f***@domain.com` |
| Phone Numbers | PII | Show last 4 digits only: `(***) ***-7890` |

### Agent Logging Rules

- PII **must be masked** in all logs, traces, debug output, and error messages using the masking rules above.
- Raw PII must never appear in application logs, monitoring dashboards, or alerting systems.
- Agents must not echo PII back to the user unnecessarily; confirm only when required for verification.

### Data Retention

- Agent conversation logs are retained for a minimum of **7 years** (state minimum requirement).
- All PII fields must be **encrypted at rest** using **AES-256** encryption.
- Encryption keys must be managed through a dedicated key management service and rotated annually.

### Transmission

- PII must only be transmitted over **TLS 1.2 or higher**.
- PII must **never** appear in:
  - URL parameters
  - Query strings
  - Email subject lines
  - Unencrypted email bodies
  - Browser local storage or cookies

### Right to Deletion

- Clients may request deletion of their PII under the **California Consumer Privacy Act (CCPA)** or equivalent state privacy laws.
- Deletion requests must be processed within **45 calendar days** of receipt.
- Deletion must be confirmed in writing to the client.
- Regulatory-required records (e.g., policy documents, audit logs) are exempt from deletion but must be anonymized where possible.

### Breach Notification

- Any suspected or confirmed data breach must be reported internally within **24 hours** of discovery.
- Affected clients and applicable state regulators must be notified within **72 hours** per state breach notification requirements.
- A breach incident report must be filed and retained for a minimum of 7 years.

---

## 2. E&O Escalation Triggers

The following situations **require immediate escalation to a human**. The AI agent must not attempt to resolve these independently.

| # | Trigger | Action Required |
|---|---|---|
| 1 | Client asks "do I have enough coverage?" or any **coverage adequacy question** | Route to a **licensed producer** for review. Agent must not provide coverage adequacy opinions. |
| 2 | Client requests to **reduce liability limits below state minimum** | Agent must **refuse** the change and explain applicable state minimum requirements. Escalate if client insists. |
| 3 | **Binding any policy** with premium exceeding **$10,000** | Requires **principal approval** before binding. Agent must not bind without documented approval. |
| 4 | Any mention of **lawsuit, attorney, legal action, subpoena, or litigation** | Route to **claims specialist immediately**. Do not discuss legal matters or provide legal guidance. |
| 5 | Client is in a **state where the agency lacks appointment** | Agent **cannot quote or bind**. Must disclose that the agency is not appointed in the client's state. |
| 6 | **Conflict between carrier underwriting guidelines and client request** | Route to a **licensed producer** for human review and resolution. |
| 7 | Client **reports a claim or potential claim** | Route to **claims specialist**. Agent must not advise on claim handling or coverage applicability. |
| 8 | Request to **backdate a policy effective date** | Must be reviewed and approved by a **principal**. Agent must not backdate without authorization. |
| 9 | Client requests **surplus lines placement** | Requires verification of **separate surplus lines license**. Agent must confirm licensing before proceeding. |
| 10 | Discussion of **policy exclusions that could create coverage gaps** | A **licensed producer** must review and confirm the client understands the implications of any exclusion. |

**General Rule:** When in doubt, escalate. An unnecessary escalation is always preferable to an E&O exposure.

---

## 3. State-Specific Rules

### California (CA)

- **Proposition 103:** All rate changes must be approved by the California Department of Insurance. This may cause delays in quoting as carriers await regulatory approval for new rates.
- **Earthquake Insurance:** The agent **must disclose** the availability of California Earthquake Authority (CEA) earthquake coverage when writing or renewing any homeowners policy. This disclosure must be documented.
- **Good Driver Discount:** A **mandatory 20% discount** must be applied for drivers with clean records — defined as no at-fault accidents or moving violations in the preceding 3 years.
- **Cancellation Notice Requirements:**
  - Non-payment: **30 days** written notice
  - Fraud: **10 days** written notice
- **CCPA:** The California Consumer Privacy Act applies to all client data. Clients have the right to know what data is collected, request deletion, and opt out of data sales.

### Texas (TX)

- **Windstorm/Hail (TWIA):** The Texas Windstorm Insurance Association is required for properties in designated coastal counties (first-tier and second-tier). Agent must check if the property is in a TWIA-eligible zone.
- **Uninsured Motorist Rejection:** Rejection of uninsured motorist coverage **must be in writing** and **signed by the named insured**. The agent must document that the coverage was offered and the client declined.
- **Cancellation Notice Requirements:**
  - Non-payment: **10 days** notice
  - All other reasons: **30 days** notice
- **Surplus Lines:** A **15-day filing requirement** with the Texas Department of Insurance applies to all surplus lines placements.
- **Flood Disclosure:** The agent **must inform** clients in designated flood zones about both NFIP (National Flood Insurance Program) and private flood insurance options.

### Florida (FL)

- **Citizens Insurance:** Citizens Property Insurance Corporation is the insurer of last resort. To place coverage with Citizens, the agent must demonstrate that the client was **rejected by at least 3 private carriers**.
- **Sinkhole Coverage:** **Mandatory disclosure** of sinkhole coverage options is required for all property policies. The agent must present this option and document the client's decision.
- **Assignment of Benefits (AOB):** Recent legislative reforms limit AOB abuse. The agent should explain the client's rights regarding AOB and advise caution before signing any AOB agreements.
- **PIP (Personal Injury Protection):** **Mandatory $10,000 PIP** coverage is required on all auto policies in Florida.
- **Hurricane Deductibles:** A separate hurricane deductible (typically **2–5% of dwelling value**) applies. This must be **clearly disclosed** to the client at quoting and binding.
- **Cancellation Restrictions:** After **120 days** from policy inception, the insurer can only cancel for specific statutory reasons (non-payment, fraud, material misrepresentation, or substantial change in risk).

### New York (NY)

- **No-Fault PIP:** Mandatory personal injury protection with a minimum of **$50,000 per person**.
- **SUM (Supplementary Uninsured/Underinsured Motorist):** Must be **offered with limits equal to bodily injury (BI) limits**. The agent must document the offer and the client's election or rejection.
- **Homeowners Cancellation:** Requires **60 days advance written notice** to the policyholder.
- **Free Look Period:** A **10-day free look period** applies to all life insurance policies. During this period, the client may return the policy for a full refund.
- **DFS Complaints:** If a client threatens regulatory action, the complaint must be reported to the **New York Department of Financial Services (DFS)**. The agent must escalate immediately and not attempt to dissuade the client from filing.

### State Minimum Auto Liability Limits (Quick Reference)

| State | Bodily Injury (per person/per accident) | Property Damage |
|---|---|---|
| CA | $15,000 / $30,000 | $5,000 |
| TX | $30,000 / $60,000 | $25,000 |
| FL | $10,000 / $20,000 (BI required with PIP) | $10,000 |
| NY | $25,000 / $50,000 | $10,000 |

---

## 4. Carrier Authorization

- **Quoting:** An agent may quote on behalf of any carrier with which the agency holds an active appointment.
- **Binding:** Binding coverage requires an **active producer license** in the **client's state of residence**. The agent must verify license status before binding.
- **Surplus Lines:**
  - Requires a **separate surplus lines license** in addition to the standard producer license.
  - All surplus lines placements must be **filed with the state Department of Insurance** within the state-specified timeframe.
- **Appointment Verification:** The agent must verify appointment status with the carrier **before presenting carrier-specific quotes** to the client. Presenting quotes from a carrier without an active appointment is a compliance violation.
- **License Renewal:** Producer licenses must be renewed per each state's schedule, typically **every 2 years**. Lapsed licenses immediately suspend binding authority.
- **Continuing Education:** All applicable continuing education (CE) requirements must be current for the agent to exercise binding authority. An agent with lapsed CE must not bind coverage.
- **Carrier Contract Requirements:** Appointment contracts may include:
  - Minimum premium volume requirements
  - Loss ratio thresholds
  - Production minimums by line of business
  - Failure to meet these thresholds may result in appointment termination by the carrier.

---

## 5. Audit Trail Requirements

### Required Fields for Every Agent Action

Every action performed by an agent (AI or human) must be logged with the following fields:

| Field | Format | Description |
|---|---|---|
| `timestamp` | ISO 8601 (`YYYY-MM-DDTHH:MM:SS.sssZ`) | Exact time of the action |
| `agent_id` | String | Unique identifier of the agent performing the action |
| `user_context` | String | Identifier of the human who initiated or authorized the action |
| `system_touched` | String | The system or service affected (e.g., `policy_admin`, `rating_engine`) |
| `action_type` | Enum | Type of action (`quote`, `bind`, `endorse`, `cancel`, `inquiry`, `escalation`) |
| `resource_ids` | Array of strings | IDs of affected resources (policy numbers, quote IDs, client IDs) |
| `reason` | String (min 10 chars) | Required for all `bind`, `cancel`, and `endorse` actions |
| `status` | Enum | `success` or `failure` |
| `before_state` | JSON object | State of the resource before modification (null for new resources) |
| `after_state` | JSON object | State of the resource after modification |
| `error_detail` | JSON object | For failed actions: error message, code, and stack trace correlation ID |

### Logging Rules

- **Failed actions** must be logged with full error detail, including a stack trace correlation ID for debugging.
- All `bind`, `cancel`, and `endorse` actions require a **`reason` field** with a minimum of **10 characters** of free text.
- Logs must be **immutable** — append-only. No updates or deletions are permitted under any circumstances.
- All data modifications must capture **before and after state** in the log entry.
- Log format: **structured JSON**, one entry per action, one entry per line.

### Retention

| Policy Type | Minimum Retention |
|---|---|
| All policy types | 7 years |

### Review

- A **quarterly audit review** must be conducted by the operations manager.
- Review must verify log completeness, identify anomalies, and confirm no gaps in the audit trail.
- Quarterly review results must be documented and retained for the same period as the logs they cover.

### Example Audit Log Entry

```json
{
  "timestamp": "2026-02-18T14:32:07.123Z",
  "agent_id": "agent-evergreen-017",
  "user_context": "jsmith@evergreenins.com",
  "system_touched": "policy_admin",
  "action_type": "endorse",
  "resource_ids": ["POL-2026-CA-004821", "END-0012"],
  "reason": "Client requested addition of scheduled jewelry rider, appraised value $12,500",
  "status": "success",
  "before_state": {
    "policy_id": "POL-2026-CA-004821",
    "scheduled_items": [],
    "annual_premium": 1842.00
  },
  "after_state": {
    "policy_id": "POL-2026-CA-004821",
    "scheduled_items": [
      {
        "item": "Engagement ring",
        "appraised_value": 12500,
        "coverage_type": "agreed_value"
      }
    ],
    "annual_premium": 1967.00
  },
  "error_detail": null
}
```

---

*This document is maintained by the Evergreen Insurance Partners compliance team. All agents — AI and human — are expected to be familiar with and operate in accordance with these rules. Violations may result in disciplinary action, license suspension, or regulatory penalties.*
