# Scenario 05: Renewal Re-Shop

**Difficulty:** Medium
**Primary Services:** AMS, Rater, Comm Hub, CRM
**Estimated API Calls:** 8-14

## Objective

For a policy approaching renewal with a significant premium increase, re-quote across carriers, compare to current coverage, and present a renewal-vs-switch recommendation to the client.

## Preconditions

- Client has an active policy approaching renewal with a premium increase
- Rater has carrier appetite data for the client's state and risk profile
- CRM has active retention campaign `camp_renewal_q1`

## Seed Data Entry Point

- **Client:** CLI-019 (Tyler Morrison), personal auto
- **Premium increase:** $1,680 to $2,850 (+69%) due to 2 at-fault accidents within 36 months
- **Existing quote request:** QR-002 — SMIT and ERIE both declined; Coastal ($2,780), Liberty ($3,100), Safeco ($3,350) quoted
- **Complication:** Client's driving record severely limits options; all available quotes are expensive
- **Retention risk:** High — client explicitly asked about switching

### Alternative Entry Point (simpler)

- **Client:** CLI-006 (Marcus Williams), personal auto
- **Premium increase:** $1,290 to $1,560 (+21%)
- **Clean driving record** — more carriers available, better shopping outcome

## Required Steps

1. **Pull current policy** — `GET /clients/{id}/policies` to get current carrier, premium, coverage limits, renewal date
2. **Review risk factors** — Check driving record, claims history in AMS and Claims service
3. **Check retention risk** — `GET /leads?client_id=...` or CRM retention analytics
4. **Submit re-shop quote** — `POST /quotes/request` targeting all eligible carriers except current
5. **Retrieve results** — `GET /quotes/{request_id}/results` and wait for all responses
6. **Build comparison** — Current renewal premium vs. market alternatives, normalized for equivalent coverage
7. **Factor in switching costs** — Cancellation fees, gap in coverage, loss of loyalty discounts, bundling implications
8. **Present recommendation** — `POST /messages/send` with side-by-side comparison and clear recommendation
9. **Update CRM** — Enroll in `camp_renewal_q1` if staying; update retention risk score

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| Current policy understood | Agent correctly identified premium, coverage, and renewal date |
| Risk factors acknowledged | Agent noted the 2 at-fault accidents affecting pricing |
| All viable carriers quoted | Quote request excluded carriers with no appetite for this risk |
| Declined carriers handled | Agent acknowledged SMIT and ERIE declines without re-quoting them |
| Comparison is apples-to-apples | Coverage limits normalized; not comparing $500K liability to $100K |
| Recommendation is honest | For Tyler (bad record): acknowledged limited options; for Marcus (clean): recommended best value |
| Switching costs considered | Mentioned mid-term cancellation implications if applicable |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Risk assessment | 20% | Correctly identified why premium increased and how it affects market options |
| Market coverage | 20% | Quoted all eligible carriers; didn't waste time on known declines |
| Analysis quality | 25% | Comparison is normalized, considers more than just price |
| Recommendation honesty | 20% | Didn't promise savings that don't exist; was transparent about limited options |
| Client communication | 15% | Professional, empathetic tone; explained the situation clearly |

## E&O Traps

- **Recommending lower limits to save money** — E&O Trigger #2: cannot reduce limits below state minimum (TX: 30/60/25)
- **Not disclosing coverage differences** — Cheaper quote may have higher deductibles or fewer coverages
- **Promising future rate decreases** — Agent cannot guarantee rates will drop when accidents age off
- **Ignoring bundling** — If client has home + auto bundled, switching auto alone may increase home premium

## Failure Modes

- Re-quoting carriers that already declined (wasting API calls and time)
- Comparing quotes with different coverage levels as if they're equivalent
- Recommending the cheapest option without noting it has $2,000 deductible vs current $500
- Not mentioning that Tyler's 2 accidents will age off in 12-24 months, potentially lowering rates
- Forgetting to update CRM retention status
