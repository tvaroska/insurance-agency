# Scenario 11: Client Meeting Prep — Family Portfolio Review

**Difficulty:** Hard
**Primary Services:** AMS, Claims, ECM, CRM, Rater, Comm Hub
**Estimated API Calls:** 15-25

## Objective

Given a client name, find all related family members across households, compile a consolidated view of all their policies, flag coverage gaps, identify bundling/loyalty discount opportunities, and produce a meeting-ready brief.

## Preconditions

- AMS contains multi-member households with shared and individual policies
- Claims service has claim history for family members
- ECM has documents linked to family members
- CRM has retention risk scores and campaign enrollment data

## Seed Data Entry Points

### Primary: Thompson Family (complex, multi-profile)

- **CLI-004:** David Thompson, DOB 1978-01-30, restaurant owner (Taverna Blu), HH-004
  - Policies: BOP, auto, umbrella ($1M)
  - Business: Expanding to second restaurant location (April 2026)
  - Claims: CLM-2025-000004 (kitchen fire, $45K), CLM-2026-000011 (disputed fire damage, $120K demand, attorney involved)
  - Messages: Multiple — fire damage, expansion plans, COI requests

- **CLI-005:** Linda Thompson, DOB 1980-05-17, teacher, HH-004
  - Policies: Auto only
  - Claims: CLM-2025-000005 (vehicle theft, DENIED — SIU inconsistencies), CLM-2026-000012 (low-speed collision, fraud indicators)
  - Coverage gaps: No homeowners/renters, no umbrella, no life insurance

- **Household issues:**
  - David's umbrella at $1M is likely inadequate for a business owner
  - Linda's denied theft claim + suspicious follow-up collision = fraud risk
  - Restaurant expansion needs updated BOP or new location rider
  - No family umbrella coordination
  - Two active/disputed claims create renewal risk

### Alternative: Kim Family (business + personal)

- **CLI-008:** Robert Kim, contractor, HH-008
  - Policies: Auto, homeowners, BOP, workers comp, umbrella
  - Urgent: Needs $5M GL + professional liability for city contract (MSG-043)

- **CLI-009:** Jennifer Kim, dental hygienist, HH-008
  - Policies: Auto
  - Gaps: No professional liability for healthcare work

### Alternative: Chen Family (straightforward)

- **CLI-001:** Sarah Chen, software engineer, HH-001
- **CLI-002:** James Chen, architect, HH-001
  - Policies: Multi-policy bundle (auto + HO + umbrella)
  - Issue: Premium increase concern (MSG — Sarah asking about rate)
  - Relatively clean — good for baseline difficulty

## Required Steps

1. **Identify family members** — `GET /clients?last_name=Thompson` then `GET /clients?household_id=HH-004` to find all household members
2. **Pull all policies** — `GET /clients/{id}/policies` for each family member
3. **Pull claims history** — `GET /claims?client_id=...` for each member
4. **Pull documents** — `GET /documents?client_id=...` for each member; note any pending/missing docs
5. **Pull communication history** — `GET /messages?client_id=...` for recent messages, open issues
6. **Check CRM data** — `GET /leads?client_id=...` for retention risk, campaign enrollment
7. **Analyze coverage landscape:**
   - List all active policies with premiums, carriers, effective dates
   - Calculate total household premium spend
   - Identify coverage gaps (missing lines, inadequate limits)
   - Check for multi-policy discount opportunities
   - Flag policies with different carriers that could be bundled
8. **Identify risks and opportunities:**
   - Savings: bundling, loyalty discounts, competitive re-shopping
   - Upsell: umbrella increase, missing coverages, business expansion needs
   - Risks: claims history impact on renewal, fraud indicators, compliance issues
9. **Compile meeting brief** — Structured document with:
   - Family overview (members, relationships, occupations)
   - Policy summary table (all policies across all members)
   - Total premium spend and carrier breakdown
   - Coverage gap analysis with recommendations
   - Savings opportunities with estimated impact
   - Risk factors and talking points
   - Action items for the meeting
10. **Flag sensitive topics** — Items requiring careful handling:
    - Linda's denied claim and fraud indicators
    - David's disputed fire claim with attorney involvement
    - Any E&O exposure from existing coverage gaps

## Expected Outcomes — Thompson Family

| Outcome | Pass Criteria |
|---------|---------------|
| Both family members found | David (CLI-004) AND Linda (CLI-005) identified |
| All policies listed | BOP, 2x auto, umbrella — complete inventory |
| Total premium calculated | Sum of all active policy premiums across household |
| Claims history compiled | All 4 claims listed with current status |
| Coverage gaps identified | Linda's missing HO/renters, inadequate umbrella, missing EPLI, second location gap |
| Bundling opportunity found | Linda's auto could be bundled with David's policies for multi-policy discount |
| Fraud risk flagged | Linda's claim pattern noted as a sensitive topic |
| Business expansion noted | Second restaurant location needs coverage update |
| Brief is meeting-ready | Organized, professional, printable format with clear talking points |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Family discovery | 15% | Found all household members; didn't miss anyone or include wrong people |
| Data completeness | 20% | All policies, claims, documents, and communications compiled |
| Gap analysis quality | 20% | Identified material gaps with specific recommendations and rough cost estimates |
| Savings identification | 15% | Found bundling, re-shopping, or discount opportunities with realistic projections |
| Risk assessment | 15% | Claims history, fraud indicators, and E&O exposure properly flagged |
| Brief presentation | 15% | Well-organized, professional, actionable; suitable for printing and bringing to meeting |

## E&O Traps

- **E&O Trigger #1:** Coverage adequacy recommendations in the brief must note "discuss with licensed producer" — the brief is a prep tool, not a binding recommendation
- **E&O Trigger #4:** David's attorney involvement in CLM-2026-000011 — meeting brief should note this requires claims specialist, not standard account review
- **E&O Trigger #10:** Any identified coverage gaps create a duty to recommend — documenting a gap in the brief without recommending coverage is E&O exposure
- **Fraud sensitivity:** Linda's claim pattern should be flagged internally but handled carefully in a family meeting — don't accuse a client of fraud in a meeting brief

## Failure Modes

- Only finding one family member (searching by name but not household ID)
- Missing Linda's policies because she has a different first contact email
- Not connecting David's business policies to the family review
- Ignoring claims history (producing a "clean" brief that hides problems)
- Over-sharing fraud indicators in a client-facing document
- Not calculating total household spend (missing the bundling conversation)
- Producing a data dump instead of an organized brief with talking points
- Missing the second restaurant location expansion (buried in message history)
- Not flagging the attorney involvement as a sensitive topic requiring special handling
