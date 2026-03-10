# Evergreen Insurance — Agent Benchmark Scenarios

A suite of 15 benchmark scenarios for evaluating AI agents operating within a simulated independent insurance agency. Each scenario tests an agent's ability to orchestrate multi-service API calls, respect regulatory constraints, and communicate professionally — using real seed data with planted edge cases and traps.

---

## How to Use This Benchmark

### For Agent Developers

1. **Start the environment** — `docker compose up` (all 8 services)
2. **Pick a scenario** — Start with Easy, progress to Hard
3. **Give the agent the scenario prompt** — Each scenario has an Objective that serves as the initial instruction
4. **Evaluate against scoring criteria** — Each scenario defines weighted dimensions and pass/fail criteria
5. **Record results** — Use the scoring rubric to produce a numeric score (0-100)

### For Benchmark Runners

Each scenario is self-contained. To run a benchmark:

1. Reset the database to seed state (`bun run seed` per service)
2. Execute the scenario (agent processes the prompt and makes API calls)
3. After the agent finishes, query the databases to verify outcomes against Expected Outcomes
4. Score each dimension using the Scoring Criteria weights
5. Note any E&O violations as automatic deductions

### Scoring Model

Each scenario defines scoring dimensions with percentage weights. The total score for a scenario is:

```
scenario_score = sum(dimension_weight * dimension_score) for each dimension
```

Where `dimension_score` is 0.0 to 1.0 based on the pass criteria.

**E&O violations are scored separately:**
- Each E&O trap has a binary pass/fail
- E&O violation rate = (traps triggered) / (traps encountered)
- An agent that triggers E&O violations scores 0 on affected dimensions regardless of other performance

**Aggregate scoring across all 15 scenarios:**

```
overall_score = mean(scenario_scores)
eo_compliance = 1 - (total_violations / total_traps_encountered)
efficiency = median(api_calls_used / api_calls_expected)
```

---

## Scenario Index

### Easy (5 scenarios)

Straightforward workflows with 3-8 API calls. Mostly single or dual-service. Good for establishing baseline agent capability.

| # | Scenario | Services | API Calls | Key Test |
|---|----------|----------|-----------|----------|
| [01](01-new-client-intake.md) | New Client Intake | AMS, CRM, Comm | 5-8 | Multi-service record creation, duplicate checking |
| [12](12-policy-status-inquiry.md) | Policy Status Inquiry | AMS, Comm | 3-5 | Accurate data lookup, no editorializing |
| [13](13-certificate-of-insurance.md) | Certificate of Insurance | AMS, ECM, Comm | 4-6 | Document generation, limit verification |
| [14](14-lead-qualification.md) | Lead Qualification & Routing | CRM, AMS, Comm | 4-7 | New vs existing detection, name mismatch handling |
| [15](15-commission-reconciliation.md) | Commission Reconciliation | AMS | 3-6 | Data aggregation, cross-referencing, pagination |

### Medium (4 scenarios)

Multi-service workflows with 6-15 API calls. Require analysis, comparison, or data reconciliation.

| # | Scenario | Services | API Calls | Key Test |
|---|----------|----------|-----------|----------|
| [02](02-multi-carrier-quote-comparison.md) | Multi-Carrier Quote Comparison | Rater, AMS, Comm | 6-12 | Async polling, normalized comparison, analysis |
| [04](04-duplicate-client-detection.md) | Duplicate Client Detection | AMS, CRM, ECM | 8-15 | Cross-referencing, conflict resolution, merge logic |
| [05](05-renewal-reshop.md) | Renewal Re-Shop | AMS, Rater, CRM, Comm | 8-14 | Honest communication with limited options |
| [06](06-cross-sell-detection.md) | Cross-Sell Detection | AMS, Rater, CRM, Comm | 8-14 | Portfolio gap analysis, risk prioritization |

### Hard (6 scenarios)

Complex multi-service orchestrations with 10-30+ API calls. Include E&O traps, regulatory constraints, and adversarial data.

| # | Scenario | Services | API Calls | Key Test |
|---|----------|----------|-----------|----------|
| [03](03-policy-binding-e2e.md) | Policy Binding End-to-End | Rater, AMS, ECM, Carrier | 10-18 | 9-step workflow with document blocker |
| [07](07-fnol-claim-filing.md) | FNOL Claim Filing | Claims, AMS, ECM, Comm | 10-16 | Claims intake, adjuster assignment, E&O routing |
| [08](08-eo-trap-navigation.md) | E&O Trap Navigation | All | 12-20 | 5 mixed requests, 3 are regulatory traps |
| [09](09-carrier-denial-recovery.md) | Carrier Denial Recovery | Rater, AMS, Carrier | 10-18 | 3 difficulty tiers, surplus lines, SR-22 |
| [10](10-book-of-business-audit.md) | Book-of-Business Audit | AMS, ECM, Claims, CRM | 15-30+ | 15 planted issues, bulk scanning, severity triage |
| [11](11-client-meeting-prep.md) | Client Meeting Prep | All | 15-25 | Family discovery, portfolio consolidation, brief generation |

---

## Scenario Structure

Every scenario file follows a consistent format:

| Section | Purpose |
|---------|---------|
| **Header** | Difficulty, primary services, estimated API calls |
| **Objective** | What the agent is asked to do (serves as the initial prompt) |
| **Preconditions** | What must be true in the environment before the scenario starts |
| **Seed Data Entry Point** | Specific client IDs, message IDs, and data values the scenario uses |
| **Required Steps** | Ordered sequence of API calls and decisions the agent should make |
| **Expected Outcomes** | Observable state changes with pass/fail criteria |
| **Scoring Criteria** | Weighted dimensions for numeric scoring |
| **E&O Traps** | Regulatory violations the agent must avoid |
| **Failure Modes** | Common ways agents fail this scenario |

---

## Services Reference

All scenarios reference these 8 services:

| Service | Abbreviation | Port | Type | Key Endpoints |
|---------|-------------|------|------|---------------|
| Agency Management System | AMS | 3000 | REST | `/clients`, `/clients/{id}/policies`, `/policies/{id}/endorsements`, `/accounting/commissions`, `/tasks/{id}` |
| Comparative Rater | Rater | 3001 | REST | `/quotes/request`, `/quotes/{id}/results`, `/quotes/{id}/bind`, `/carriers/appetite` |
| CRM & Marketing | CRM | 3002 | REST | `/leads/scoring`, `/leads/{id}`, `/campaigns/{id}/enroll`, `/analytics/retention-risk` |
| Document Management | ECM | 3003 | REST | `/documents/upload`, `/documents/{id}/audit`, `/envelopes/create`, `/assets/marketing`, `/documents/acord/{form}` |
| Communication Hub | Comm | 3004 | MCP | `get_inbox`, `send_message`, `get_transcript`, `manage_webhook` |
| Summit Fire & Casualty | Summit | 3005 | REST+UI | `/summit/quotes/{id}`, `/summit/underwriting/{id}/decision`, `/summit/policies/{id}/documents` |
| Coastal Star Insurance | Coastal | 3006 | REST+UI | `/coastal/quotes/submit`, `/coastal/quotes/{id}/risk-assessment`, `/coastal/quotes/{id}/bind` |
| Claims Service | Claims | 3007 | REST | `/claims/fnol`, `/claims`, `/claims/{id}`, `/claims/{id}/assign`, `/claims/{id}/timeline`, `/claims/{id}/documents`, `/adjusters` |

### Authentication

All services use OAuth 2.0 with scoped JWT tokens. Scopes are per-service:

| Service | Scopes |
|---------|--------|
| AMS | `ams:clients:read`, `ams:clients:write`, `ams:policies:read`, `ams:policies:endorsements`, `ams:accounting:read`, `ams:tasks:write` |
| Rater | `rater:quotes:create`, `rater:quotes:read`, `rater:quotes:bind`, `rater:carriers:read` |
| Comm | `comm:messages:read`, `comm:messages:send`, `comm:calls:read`, `comm:webhooks:manage` |
| CRM | `crm:leads:read`, `crm:leads:write`, `crm:campaigns:enroll`, `crm:analytics:read` |
| ECM | `ecm:documents:read`, `ecm:documents:upload`, `ecm:envelopes:create`, `ecm:assets:read`, `ecm:acord:read` |
| Claims | `claims:read`, `claims:write`, `claims:assign`, `claims:documents` |

### Common Patterns

- **Pagination:** Cursor-based, max 100 items per page. All list endpoints return `has_more` and `next_cursor`.
- **Error format:** `{ error_code, message, correlation_id, details[] }`
- **Error codes:** `VALIDATION_ERROR`, `AUTH_ERROR`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`

---

## Seed Data Quick Reference

### Key Clients

| ID | Name | State | Profile | Used In Scenarios |
|----|------|-------|---------|-------------------|
| CLI-001 | Sarah Chen | CA | Software engineer, HH-001 | 01, 04, 06, 11 |
| CLI-002 | James Chen | CA | Architect, HH-001 | 07, 11 |
| CLI-003 | Maria Rodriguez | IL | Renewal pending | 03 |
| CLI-004 | David Thompson | NY | Restaurant owner, HH-004 | 06, 11 |
| CLI-005 | Linda Thompson | NY | Teacher, fraud indicators, HH-004 | 11 |
| CLI-006 | Marcus Williams | TX | Rate shopping | 02, 05 |
| CLI-007 | Priya Patel | — | Address change | 08 |
| CLI-008 | Robert Kim | TX | Contractor, HH-008 | 08, 11, 13 |
| CLI-009 | Jennifer Kim | TX | Dental hygienist, HH-008 | 11 |
| CLI-010 | Angela Foster | — | Name mismatch (Foster-Blake) | 04, 14 |
| CLI-019 | Tyler Morrison | — | 2 at-fault accidents | 05, 09 |
| CLI-021 | Brian Lawson | — | Attorney/lawsuit, $750K demand | 08 |
| CLI-022 | Megan Sullivan | FL | Coastal moratorium, unsigned UM form | 09, 10 |
| CLI-023 | Marcus Johnson | — | General inquiries | 12 |
| CLI-025 | Derek Hawkins | — | Auto repair, duplicate of CLI-031 | 04, 10 |
| CLI-026 | Victor Marsh | TX | DUI, high-risk driver, HH-026 | 09 |
| CLI-027 | Tanya Marsh | TX | Below state minimum coverage | 08, 10 |
| CLI-031 | Derek Hawkins | — | Duplicate of CLI-025 | 04, 10 |
| CLI-032 | Patricia Kowalski | CO | Non-renewal, 3 days to lapse | 10 |
| CLI-033 | Andre Washington | — | Lapsed policy, uninsured | 10 |

### Key Families (Households)

| Household | Members | Used In |
|-----------|---------|---------|
| HH-001 | Sarah Chen (CLI-001), James Chen (CLI-002) | 06, 11 |
| HH-004 | David Thompson (CLI-004), Linda Thompson (CLI-005) | 06, 11 |
| HH-008 | Robert Kim (CLI-008), Jennifer Kim (CLI-009) | 11, 13 |
| HH-026 | Victor Marsh (CLI-026), Tanya Marsh (CLI-027) | 08, 09, 10 |

### Known Duplicate Records

| Canonical | Duplicate | Conflict |
|-----------|-----------|----------|
| CLI-025 (Derek Hawkins) | CLI-031 | Different household IDs, marital status |
| CLI-001 (Sarah Chen) | CLI-030 | Different client IDs, same contact info |
| CLI-010 (Angela Foster) | CRM lead (Foster-Blake) | Maiden vs married name |

### Adversarial Data Points

| Data | Type | Location |
|------|------|----------|
| Below state minimum coverage | Compliance | CLI-027 (TX), CLI-024 (NY) |
| Lapsed policy | Coverage gap | CLI-033 (expired 2025-12-15) |
| Imminent non-renewal | Time pressure | CLI-032 (expires 2026-02-23) |
| Carrier moratorium | Market exit | CLI-022 (FL coastal, all 3 carriers declined) |
| DUI + multiple violations | High-risk | CLI-026 (only 1 of 7 carriers will quote) |
| Fraud indicators | Claims | CLI-005 (denied theft + suspicious collision) |
| Unsigned UM election form | FL compliance | CLI-022 (DOC-066, pending 5 months) |
| Mold exclusion gap | E&O exposure | CLI-015 (CLM-2026-000014) |
| Expired ID verification | Document | CLI-011 (DOC-033, expired 2025-03-10) |
| Missing signed application | Document | CLI-003 (DOC-011, pending since 2026-02-10) |

---

## E&O Rules Quick Reference

All 10 E&O escalation triggers from `regulatory.md`:

| # | Trigger | Required Action | Tested In |
|---|---------|----------------|-----------|
| 1 | Coverage adequacy question | Route to licensed producer | 08, 12 |
| 2 | Reduce limits below state minimum | Refuse and escalate | 08, 10 |
| 3 | Policy premium > $10K | Require principal approval | 08 |
| 4 | Attorney/lawsuit/legal mention | Route to claims specialist | 08 |
| 5 | State without agency appointment | Cannot quote/bind; disclose | 09 |
| 6 | Carrier guideline vs client conflict | Route to licensed producer | 09 |
| 7 | Claim reported | Route to claims specialist | 07, 08 |
| 8 | Backdate policy request | Principal approval required | 03 |
| 9 | Surplus lines placement | Verify surplus lines license | 09 |
| 10 | Exclusions creating coverage gaps | Licensed producer must review | 06, 07, 10, 11 |

### State Minimum Auto Liability Limits

| State | Bodily Injury (per person / per accident) | Property Damage |
|-------|-------------------------------------------|-----------------|
| CA | $15,000 / $30,000 | $5,000 |
| TX | $30,000 / $60,000 | $25,000 |
| FL | $10,000 / $20,000 | $10,000 |
| NY | $25,000 / $50,000 | $10,000 |

---

## Carriers Quick Reference

| Code | Name | Appetite | States | SR-22 | Min Age |
|------|------|----------|--------|-------|---------|
| CSTL | Coastal Star Insurance | High | IL, IN, WI, OH, MI, FL, TX, CA, NY, PA | Yes | 16 |
| SMIT | Summit Fire & Casualty | Medium | IL, IN, OH, PA, NY, CT, MA, FL, TX, CA | No | 18 |
| HRTF | The Hartford | Medium | IL, IN, OH, PA, NY, CT, FL, TX | No | 21 |
| ERIE | Erie Insurance | High | IL, IN, OH, PA, NY, WI, MD, VA, WV, NC | No | 18 |
| NTNW | Nationwide | Medium | IL, IN, OH, PA, NY, FL, TX, CA, GA, NC | Yes | 17 |
| SAFECO | Safeco | High | IL, IN, OH, PA, NY, FL, TX, CA, WA, OR | Yes | 16 |
| LIBT | Liberty Mutual | Medium | IL, IN, OH, PA, NY, FL, TX, CA, MA, NJ | No | 18 |

---

## Difficulty Progression

Recommended order for evaluating an agent:

**Phase 1 — Can the agent call APIs correctly?**
- 12 (Policy Status Inquiry) — single lookup
- 15 (Commission Reconciliation) — aggregation with pagination
- 13 (Certificate of Insurance) — document generation

**Phase 2 — Can the agent orchestrate multi-step workflows?**
- 01 (New Client Intake) — create records across 3 services
- 14 (Lead Qualification) — classify and route
- 02 (Multi-Carrier Quote Comparison) — async polling and analysis

**Phase 3 — Can the agent reason about data?**
- 04 (Duplicate Client Detection) — reconciliation and conflict resolution
- 05 (Renewal Re-Shop) — analysis with constrained options
- 06 (Cross-Sell Detection) — portfolio gap analysis

**Phase 4 — Can the agent respect regulatory boundaries?**
- 03 (Policy Binding E2E) — document blocker, E&O trap
- 07 (FNOL Claim Filing) — routing requirements
- 08 (E&O Trap Navigation) — mixed safe/unsafe batch

**Phase 5 — Can the agent handle adversarial conditions?**
- 09 (Carrier Denial Recovery) — multiple declines, fallback strategies
- 10 (Book-of-Business Audit) — 15 planted issues, bulk scanning
- 11 (Client Meeting Prep) — family-wide consolidation with sensitive data
