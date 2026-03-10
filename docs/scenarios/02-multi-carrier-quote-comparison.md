# Scenario 02: Multi-Carrier Quote Comparison

**Difficulty:** Medium
**Primary Services:** Rater, AMS, Comm Hub
**Estimated API Calls:** 6-12

## Objective

Given a client's risk data, request quotes from all eligible carriers, wait for responses, compare results across price/coverage/carrier reputation, and present a recommendation with justification.

## Preconditions

- Client CLI-006 (Marcus Williams) exists in AMS — has requested rate shopping due to 21% premium increase
- Rater service has carrier appetite rules loaded (7 carriers)
- Message MSG-018 contains the client's shopping request

## Seed Data Entry Point

- **Client:** CLI-006 (Marcus Williams), Austin, TX
- **Current policy:** Auto with SMIT, premium increased from $1,290 to $1,560 (+21%)
- **Existing quote request:** QR-005 shows Coastal Star bound at $1,560 — but agent should re-shop for better rate
- **Risk profile:** Clean driving record, age 40+, single vehicle

## Required Steps

1. **Pull client profile** — `GET /clients/CLI-006` and `GET /clients/CLI-006/policies` to understand current coverage
2. **Check carrier eligibility** — `GET /carriers` to identify which carriers write auto in TX for this risk profile
3. **Submit quote request** — `POST /quotes/request` with client risk data and target carriers
4. **Poll for results** — `GET /quotes/{request_id}/results` (may need multiple calls as carriers respond asynchronously)
5. **Compare quotes** — Analyze returned quotes across: premium, deductibles, coverage limits, carrier financial rating
6. **Present recommendation** — `POST /messages/send` to client with comparison summary and recommendation
7. **Document in AMS** — `POST /tasks` or update notes to record the shopping activity

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| All eligible carriers quoted | Quote request includes all carriers that write auto in TX |
| Results fully retrieved | Agent polled until all carriers responded (no premature recommendation) |
| Comparison is accurate | Premium, coverage limits, and deductibles correctly extracted and compared |
| Recommendation justified | Agent explains why the recommended carrier is best (not just cheapest) |
| Client notified | Comparison sent via Comm Hub with clear formatting |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Carrier coverage | 25% | Quoted all eligible carriers, not just a subset |
| Analysis quality | 25% | Comparison considers price, coverage, deductibles — not price alone |
| Recommendation logic | 20% | Justification is sound (e.g., same coverage for less, or better coverage at similar price) |
| Communication | 15% | Client-facing summary is clear, professional, avoids jargon |
| Efficiency | 15% | Didn't make redundant calls; handled async polling correctly |

## E&O Traps

- **Recommending based on price alone** without comparing coverage limits — cheaper policy may have lower limits
- **Not waiting for all carrier responses** — presenting partial results could miss the best option
- **Failing to disclose carrier differences** — some carriers have different claims processes, exclusions, or financial ratings
- **Quoting carriers with no appetite** — wasting time on carriers that won't write this risk

## Failure Modes

- Submitting quote request without checking carrier appetite first
- Recommending a carrier that declined the risk
- Not polling long enough (QR-015 shows Daniel Reeves has pending/error responses — agent should handle timeouts)
- Presenting raw API data to client instead of a human-readable comparison
