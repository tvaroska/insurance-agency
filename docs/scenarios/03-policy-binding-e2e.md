# Scenario 03: Policy Binding End-to-End

**Difficulty:** Hard
**Primary Services:** Rater, AMS, ECM, Carrier Portals, Comm Hub
**Estimated API Calls:** 10-18

## Objective

Take an accepted quote through the full binding workflow: create the policy in AMS, generate ACORD forms, confirm bind with the carrier portal, log the commission, and notify the client.

## Preconditions

- Client CLI-003 (Maria Rodriguez) has an accepted quote in Rater
- Quote QR-001 has 4 carrier quotes, all approved; Nationwide (NTNW) is lowest at $1,010/year
- ECM service can generate ACORD Form 90 (auto application)
- Carrier portal (Coastal Star or Summit) has bind confirmation endpoint

## Seed Data Entry Point

- **Client:** CLI-003 (Maria Rodriguez), Chicago, IL
- **Quote Request:** QR-001 — personal auto, 4 quotes returned
- **Selected Quote:** Nationwide at $1,010/year
- **Complication:** DOC-011 (signed application) is still PENDING_SIGNATURE — binding requires a signed application

## Required Steps

1. **Retrieve quote details** — `GET /quotes/QR-001` to confirm selected carrier and premium
2. **Check documentation** — `GET /documents?client_id=CLI-003` to verify all required docs are signed
3. **Handle missing signature** — DOC-011 is pending; agent must either:
   - Send signature reminder via `POST /messages/send`, OR
   - Create e-signature envelope via `POST /envelopes/create`
4. **Bind the quote** — `POST /quotes/{quote_id}/bind` once documentation is complete
5. **Create policy in AMS** — `POST /policies` (or verify auto-creation from bind)
6. **Generate ACORD Form 90** — `POST /documents/acord/generate` with form_type=90 and policy data
7. **Log commission** — Verify commission record created in `GET /accounting/commissions?policy_id=...`
8. **Notify client** — `POST /messages/send` with policy number, effective date, ID card info, and payment instructions
9. **Close CRM lead** — Update lead status to `closed_won` if applicable

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| Documentation complete | Agent identified missing signature and took action before binding |
| Quote bound | Bind confirmation received from carrier |
| Policy created in AMS | Policy record exists with correct carrier, premium, effective date |
| ACORD form generated | Form 90 created and linked to policy |
| Commission logged | Commission record exists with correct rate and amount |
| Client notified | Confirmation message includes policy number and next steps |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Document compliance | 25% | Caught the missing signature; did not bind without it |
| Workflow completeness | 25% | All 9 steps performed in correct order |
| Cross-service consistency | 20% | Policy data matches across AMS, Rater, ECM, and carrier portal |
| Client communication | 15% | Binding confirmation is complete and professional |
| Error handling | 15% | Gracefully handled the pending signature blocker |

## E&O Traps

- **Binding without signed application** — DOC-011 is pending. Binding without a signed app is an E&O violation (E&O Trigger #8: backdating/incomplete documentation)
- **Incorrect coverage on ACORD form** — Form 90 must match the quoted coverage exactly
- **Missing commission entry** — Agency doesn't get paid; accounting discrepancy

## Failure Modes

- Attempting to bind before resolving the pending signature
- Generating ACORD form with wrong coverage limits
- Not creating or verifying the commission record
- Binding with wrong carrier (not the one the client selected)
- Not notifying the client after successful bind
- Creating duplicate policy records
