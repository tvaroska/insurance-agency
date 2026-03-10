# Scenario 06: Cross-Sell Detection

**Difficulty:** Medium
**Primary Services:** AMS, Rater, CRM, Comm Hub
**Estimated API Calls:** 8-14

## Objective

Analyze an existing client's policy portfolio, identify coverage gaps (e.g., has auto and home but no umbrella), generate a quote for the missing line, and enroll them in a cross-sell campaign.

## Preconditions

- Client has multiple active policies but an identifiable gap
- CRM has active campaign `camp_life_pivot_2026` (cross-sell, 23% conversion)
- Rater can quote the missing line of business

## Seed Data Entry Point

- **Client:** CLI-004 (David Thompson), New York, NY
- **Occupation:** Restaurant owner (Taverna Blu), expanding to second location
- **Current policies:** BOP, auto, umbrella ($1M)
- **Coverage gaps:**
  - Umbrella is only $1M — attorney (MSG-044 for similar client) recommends $3-5M for business owners
  - No professional liability / employment practices liability for restaurant
  - Expanding to second location — current BOP may not cover new premises
  - Wife Linda (CLI-005) has auto only — no renters/homeowners
- **Additional context:** MSG-044 (William Okafor, similar profile) shows an E&O trigger where client's attorney questioned why higher umbrella wasn't recommended

### Alternative Entry Point

- **Client:** CLI-001 (Sarah Chen), Los Angeles, CA
- **Current policies:** Auto + homeowners
- **Gap:** No umbrella policy — high net worth household (software engineer + architect)
- **CRM lead:** lead_8f3a12c4, score 92, "high-value auto-and-home"

## Required Steps

1. **Pull full policy portfolio** — `GET /clients/{id}/policies` for the client and household members
2. **Analyze coverage gaps** — Compare policies against standard recommendations for client profile:
   - Personal: auto, home, umbrella, life
   - Business: BOP/GL, workers comp, professional liability, EPLI, cyber, commercial auto
3. **Prioritize gaps by risk** — Rank missing coverages by exposure severity
4. **Quote the highest-priority gap** — `POST /quotes/request` for the missing line
5. **Retrieve quote results** — `GET /quotes/{request_id}/results`
6. **Prepare recommendation** — Build a gap analysis with prioritized recommendations
7. **Enroll in cross-sell campaign** — `POST /leads/{id}/enroll` into `camp_life_pivot_2026`
8. **Send recommendation** — `POST /messages/send` with gap analysis and quote summary
9. **Create follow-up task** — `POST /tasks` for licensed producer to discuss coverage options

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| All household policies found | Agent pulled policies for David AND Linda Thompson |
| Gaps correctly identified | At minimum: umbrella inadequacy, missing EPLI, second location coverage |
| Gaps prioritized | Higher-exposure gaps ranked first (e.g., umbrella increase > cyber liability) |
| Quote generated | At least one quote for the highest-priority gap |
| Campaign enrollment | Client enrolled in appropriate cross-sell campaign |
| Recommendation is actionable | Includes specific coverage amounts and approximate costs |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Gap detection | 30% | Found all material coverage gaps across the household |
| Risk prioritization | 20% | Ranked gaps by exposure severity, not just ease of sale |
| Quote accuracy | 15% | Quoted the right coverage type with appropriate limits |
| Cross-sell execution | 15% | Campaign enrollment and follow-up task created |
| Communication | 20% | Recommendation is clear, not pushy, explains why each coverage matters |

## E&O Traps

- **E&O Trigger #10:** Identifying a coverage gap creates a duty to document and recommend — if the agent finds a gap and doesn't recommend coverage, and the client later has a loss, the agency is liable
- **E&O Trigger #1:** Coverage adequacy questions must be routed to a licensed producer — agent cannot make binding recommendations
- **Umbrella inadequacy:** MSG-044 shows an identical situation where a client's attorney questioned why higher umbrella wasn't recommended — this is a documented E&O exposure pattern
- **Second location:** Expanding business without updating BOP creates an uninsured premises — agent must flag this

## Failure Modes

- Only checking the primary client, not household members
- Identifying gaps but not generating quotes (analysis without action)
- Recommending coverage without routing to a licensed producer (E&O violation)
- Missing the second restaurant location expansion (buried in business context)
- Enrolling in wrong campaign (retention vs cross-sell)
- Over-selling: recommending every possible coverage line instead of prioritizing by actual risk
