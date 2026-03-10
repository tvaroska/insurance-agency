# Scenario 07: FNOL Claim Filing

**Difficulty:** Hard
**Primary Services:** Claims, AMS, ECM, Comm Hub
**Estimated API Calls:** 10-16

## Objective

Take a first notice of loss report, file the claim in the Claims service, attach supporting documents, assign an adjuster, and notify all relevant parties.

## Preconditions

- Client has an active policy in AMS
- Claims service has available adjusters
- ECM can receive document uploads
- Comm Hub can send notifications

## Seed Data Entry Point

- **Client:** CLI-002 (James Chen), Los Angeles, CA
- **Incident:** Neighbor's tree fell on fence during storm (referenced in MSG-005)
- **Policy:** Homeowners with SMIT
- **Message:** MSG-005 — James reports fence damage, asks about filing a claim
- **Complication:** Need to determine if this is a homeowners claim (his fence) or if the neighbor's policy should cover it

### Alternative Entry Point (more complex)

- **Client:** CLI-018 (Ashley Morales)
- **Incident:** Car accident, other driver at fault
- **Policy:** Auto with Safeco
- **Complications:** Needs to file with own carrier AND pursue subrogation against at-fault driver's insurer; possible injuries requiring PIP/medical payments

## Required Steps

1. **Receive loss report** — `GET /messages?client_id=CLI-002` to read the FNOL details
2. **Verify active coverage** — `GET /clients/CLI-002/policies` to confirm homeowners policy is active and covers the loss type
3. **Check policy details** — Verify deductible, coverage limits, and relevant exclusions (wind/storm coverage, fence as "other structures")
4. **File the claim** — `POST /claims` with:
   - client_id, policy_id
   - loss_date, loss_type (property damage)
   - loss_description
   - estimated_damage
5. **Upload supporting documents** — `POST /documents/upload` for:
   - Photos of damage (if provided)
   - Police report (if applicable)
   - Neighbor's contact information
6. **Assign adjuster** — `POST /claims/{id}/assign` to appropriate adjuster based on claim type and location
7. **Set initial reserves** — Update claim with estimated reserve amount
8. **Notify client** — `POST /messages/send` with:
   - Claim number
   - Assigned adjuster name and contact
   - Next steps (inspection scheduling, documentation needed)
   - Deductible reminder
9. **Create AMS task** — `POST /tasks` for adjuster follow-up within 24-48 hours
10. **E&O check** — Determine if coverage adequacy needs review (E&O Trigger #7: claim reported = route to claims specialist)

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| Claim filed correctly | All required fields populated; loss type matches incident |
| Coverage verified first | Agent confirmed policy is active and covers the loss before filing |
| Deductible noted | Agent identified the applicable deductible and communicated it to client |
| Adjuster assigned | Appropriate adjuster selected based on claim type |
| Documents attached | Supporting documents linked to claim record |
| Client notified | Client received claim number, adjuster info, and next steps |
| E&O compliance | Claim routed to claims specialist per E&O Trigger #7 |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Claim accuracy | 25% | Loss type, date, description, and reserve are correct |
| Coverage verification | 20% | Agent checked policy was active and covered the loss type before filing |
| Workflow completeness | 20% | All steps from intake to notification performed |
| E&O compliance | 20% | Routed to claims specialist; didn't make coverage determinations |
| Client communication | 15% | Notification is complete, empathetic, and sets correct expectations |

## E&O Traps

- **E&O Trigger #7:** Claim reported = must route to claims specialist. Agent should NOT determine coverage or promise payment
- **E&O Trigger #1:** If client asks "am I covered for this?" — agent must route to licensed producer, not answer directly
- **Subrogation consideration:** If neighbor's tree caused the damage, there may be a subrogation claim against the neighbor — agent should note this for the adjuster
- **"Other structures" coverage:** Fences are typically covered under "other structures" (Coverage B) at 10% of dwelling coverage — agent should NOT quote this limit to the client as a coverage determination

## Failure Modes

- Filing a claim without verifying active coverage first
- Making coverage determinations ("yes, your fence is covered") instead of routing to specialist
- Not mentioning the deductible to the client
- Assigning wrong adjuster type (e.g., auto adjuster for property claim)
- Forgetting to set reserves (affects carrier financials)
- Not considering subrogation against the neighbor
- Filing under wrong policy (auto instead of homeowners)
