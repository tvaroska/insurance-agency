# Scenario 10: Book-of-Business Audit

**Difficulty:** Hard
**Primary Services:** AMS, ECM, Claims, CRM
**Estimated API Calls:** 15-30+

## Objective

Scan all active policies across the agency's book of business for compliance issues, coverage gaps, missing documents, and regulatory violations. Prioritize findings by severity, create remediation tasks, and produce a summary report.

## Preconditions

- AMS contains 60+ active policies across 33 clients
- ECM has document records with audit flags
- Claims service has denied/disputed claims that indicate underlying issues
- CRM has retention risk data
- Regulatory rules define state-specific requirements

## Seed Data — Known Issues to Find

The audit should discover at minimum these planted issues:

### Critical (Immediate action required)

| Issue | Client | Details |
|-------|--------|---------|
| Below state minimum coverage | CLI-027 (Tanya Marsh) | TX auto: BI 15/30, PD 5K vs minimum 30/60/25 |
| Below state minimum coverage | CLI-024 (Rachel Adams) | NY auto: BI 10/20, PD 5K vs minimum 25/50/10 + mandatory PIP $50K |
| Lapsed policy — uninsured | CLI-033 (Andre Washington) | Policy expired 2025-12-15; driving uninsured |
| Non-renewal — 3 days to lapse | CLI-032 (Patricia Kowalski) | Safeco non-renewed auto + HO; expires 2026-02-23 |
| Unsigned UM election form | CLI-022 (Megan Sullivan) | FL requires signed UM form; DOC-066 pending since 2025-10-01 |

### High (Action within 1 week)

| Issue | Client | Details |
|-------|--------|---------|
| Missing signed application | CLI-003 (Maria Rodriguez) | DOC-011 pending signature since 2026-02-10 |
| Expired ID verification | CLI-011 (Carlos Gutierrez) | DOC-033 driver's license expired 2025-03-10 |
| Stale contact info | CLI-015 (George Papadopoulos) | Email bounced (MSG-037); phone doesn't match |
| Name mismatch | CLI-010 (Angela Foster) | AMS says "Foster"; signed docs say "Foster-Blake" |
| Duplicate client records | CLI-025/CLI-031 (Derek Hawkins) | Same person, two records, conflicting data |

### Medium (Action within 30 days)

| Issue | Client | Details |
|-------|--------|---------|
| Inadequate umbrella | CLI-013 (William Okafor) | $1M umbrella; attorney recommends $3-5M |
| Missing COI | CLI-018 (Rosa Jimenez) | Bakery catering; DOC-053 pending |
| SMS delivery failure | CLI-010 (Angela Foster) | MSG-036 failed; stale phone number |
| Coverage gap — mold exclusion | CLI-015 (George Papadopoulos) | Active claim CLM-2026-000014 with undisclosed mold exclusion |
| Fraud indicators | CLI-005 (Linda Thompson) | Two claims in 10 weeks; prior denial for inconsistencies |

## Required Steps

1. **Pull all active policies** — `GET /clients` (paginated) then `GET /clients/{id}/policies` for each
2. **Check state minimum compliance** — Compare each policy's coverage limits against state requirements
3. **Scan for lapsed/expiring policies** — Identify policies past expiration or expiring within 30 days
4. **Audit documents** — `GET /documents` filtered by status=pending_signature, status=expired
5. **Check for duplicate records** — Search for clients with matching names, DOBs, or contact info
6. **Review claims for red flags** — `GET /claims` and check for denied claims, fraud indicators, coverage disputes
7. **Verify contact info** — Cross-reference Comm Hub delivery failures with client records
8. **Categorize findings** — Group by severity: Critical / High / Medium
9. **Create remediation tasks** — `POST /tasks` for each finding with:
   - Description of the issue
   - Recommended action
   - Due date based on severity
   - Assigned to appropriate role
10. **Generate summary report** — Aggregate findings into a structured report

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| Critical issues found | All 5 critical issues identified |
| High issues found | At least 4 of 5 high issues identified |
| Medium issues found | At least 3 of 5 medium issues identified |
| Correct severity ratings | Issues categorized appropriately (below-minimum = critical, not medium) |
| Tasks created | Remediation task exists for each finding |
| Report generated | Summary with counts by severity, affected clients, and recommended actions |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Detection rate | 30% | Percentage of planted issues found (15 total) |
| Severity accuracy | 20% | Issues categorized at correct severity level |
| False positive rate | 10% | Didn't flag non-issues as problems |
| Remediation quality | 20% | Tasks are actionable with clear next steps and appropriate deadlines |
| Efficiency | 10% | Minimized API calls; used bulk queries where possible |
| Report quality | 10% | Summary is concise, organized, and actionable |

## E&O Traps

- **Every unfound critical issue is a potential E&O claim** — the point of audits is to catch these before they become lawsuits
- **Below-minimum coverage** is the highest-severity issue — the agency has active E&O exposure right now
- **Lapsed policy notification** — CLI-033 (Andre Washington) is driving uninsured; agency has a duty to notify
- **Non-renewal crisis** — CLI-032 (Patricia Kowalski) loses coverage in 3 days; failure to act is negligence

## Failure Modes

- Only checking a subset of clients (skipping pagination)
- Not knowing state minimum coverage requirements
- Finding issues but not creating remediation tasks
- Creating tasks without severity prioritization (treating everything as equal)
- Missing the duplicate records (requires cross-referencing, not just sequential scanning)
- Not connecting related issues (e.g., Angela Foster's name mismatch AND SMS failure AND duplicate lead are all the same root cause)
- Generating a report but not acting on critical findings
