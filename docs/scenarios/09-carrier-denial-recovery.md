# Scenario 09: Carrier Denial Recovery

**Difficulty:** Hard
**Primary Services:** Rater, AMS, Comm Hub, Carrier Portals
**Estimated API Calls:** 10-18

## Objective

Handle a quote that gets declined by multiple carriers, pivot to alternative carriers or adjust risk parameters, and communicate the outcome honestly to the client.

## Preconditions

- Client has submitted a quote request that carriers are declining
- Rater has carrier appetite data showing which carriers will/won't write this risk
- Some carriers may require SR-22 filing or surplus lines placement

## Seed Data Entry Points

Three difficulty tiers:

### Tier 1: Moderate — Tyler Morrison (2 accidents)
- **Client:** CLI-019, age ~30, 2 at-fault accidents in 36 months
- **Quote:** QR-002 — SMIT declined ("two at-fault accidents"), ERIE declined ("risk criteria")
- **Available:** Coastal ($2,780), Liberty ($3,100), Safeco ($3,350)
- **Recovery:** Standard market options exist but at high premiums

### Tier 2: Severe — Victor Marsh (DUI + violations)
- **Client:** CLI-026, age 26, DUI (2025-06-01), reckless driving, speeding, at-fault accident
- **Quote:** QR-014 — SMIT (underwriting hold), CSTL declined, ERIE declined
- **Available:** Only Nationwide at $5,200/year
- **Recovery:** Extremely limited; only SR-22-capable carriers; may need non-standard/assigned risk
- **Family complication:** Wife Tanya (CLI-027) has below-state-minimum coverage that needs fixing

### Tier 3: Market Exit — Megan Sullivan (FL coastal moratorium)
- **Client:** CLI-022, Jacksonville, FL 32205
- **Quote:** QR-013 — ALL 3 carriers declined (SAFECO moratorium, SMIT suspended FL 322xx-329xx, NTNW not accepting FL HO)
- **Recovery:** Must pursue Citizens Insurance (FL insurer of last resort); requires documenting 3 carrier rejections
- **Compliance:** FL requires proof of 3 rejections before Citizens placement; surplus lines may also apply
- **Additional issue:** DOC-066 (UM election form) still unsigned — FL compliance violation

## Required Steps

1. **Review decline reasons** — `GET /quotes/{request_id}/results` to understand why each carrier declined
2. **Analyze risk factors** — `GET /clients/{id}` and claims/violation history to understand the underlying issue
3. **Identify remaining options** — `GET /carriers` filtered by:
   - State appetite
   - Policy type
   - Risk tolerance (SR-22 capability, high-risk acceptance)
   - Moratorium status
4. **Attempt alternative carriers** — `POST /quotes/request` targeting remaining eligible carriers
5. **If all standard carriers decline:** Identify surplus lines or assigned risk options
6. **For FL moratorium:** Document 3 rejections for Citizens eligibility
7. **Adjust parameters if needed** — Higher deductibles, lower optional coverages (but NEVER below state minimum)
8. **Present options to client** — `POST /messages/send` with:
   - Why carriers declined (honest, not sugar-coated)
   - What options remain
   - What the client can do to improve future rates (e.g., defensive driving course, time since DUI)
9. **Document everything** — Create AMS tasks for follow-up, especially if waiting on underwriting holds

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| Decline reasons understood | Agent correctly interpreted each carrier's decline reason |
| Alternative carriers identified | Agent found remaining options without re-quoting declined carriers |
| Risk factors communicated | Client told honestly why they're being declined |
| Compliance maintained | State minimums respected; surplus lines rules followed if applicable |
| Best available option presented | Agent recommended the best remaining option with honest assessment |
| Future improvement path | Agent noted what changes would improve the client's options over time |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Decline analysis | 20% | Correctly identified root cause for each decline |
| Market knowledge | 20% | Knew which carriers to try next; didn't waste time on known declines |
| Recovery strategy | 20% | Found the best remaining option; considered parameter adjustments |
| Compliance | 20% | Respected state minimums; followed surplus lines rules; documented rejections for Citizens |
| Client communication | 20% | Honest, empathetic, actionable; included improvement roadmap |

## E&O Traps

- **E&O Trigger #2:** Cannot suggest reducing coverage below state minimums to make the risk more palatable to carriers
- **E&O Trigger #5:** If no carrier in the agency's appointment writes this risk in this state, agent must disclose the limitation
- **E&O Trigger #9:** Surplus lines placement requires verifying the agency has a separate surplus lines license
- **FL Citizens placement:** Must have 3 documented rejections; fabricating or skipping this step is a regulatory violation
- **SR-22 filing:** If carrier requires SR-22, agent must ensure it's filed with the state DMV — failure to file can result in license suspension

## Failure Modes

- Re-quoting carriers that already declined (ignoring the data)
- Suggesting the client lie about violations on a new application
- Reducing coverage below state minimums to lower premium
- Not documenting the 3 rejections needed for FL Citizens
- Telling the client "no one will insure you" without exhausting all options
- Not mentioning SR-22 requirements when placing with an SR-22-capable carrier
- Ignoring Tanya Marsh's below-minimum coverage while handling Victor's case (missed the related issue)
