# Scenario 14: Lead Qualification and Routing

**Difficulty:** Easy
**Primary Services:** CRM, AMS, Comm Hub
**Estimated API Calls:** 4-7

## Objective

An inbound lead arrives from a web form or referral. The agent must check if it's a new or existing client, score/qualify the lead, assign it to the right producer, and send an acknowledgment.

## Seed Data Entry Point

- **Lead:** lead_a1b2c3d4 (Jessica Williams, CLI-005's referral)
- **Score:** 87, source: referral, status: qualified
- **Request:** Umbrella policy for rental properties
- **Context:** Existing client's spouse referred; should be connected to the same producer

### Alternative Entry Points

- **Lead:** lead_g3h4i5j6 (Angela Foster-Blake) — "data-conflict" status
  - **Trap:** Name mismatch between web form (Foster-Blake) and AMS record (Foster, CLI-010)
  - Agent must recognize this is an existing client with a married name, not a new lead

- **Lead:** lead_h4i5j6k7 (George Papadopoulos) — score 30, "stale-contact"
  - **Trap:** Email and phone don't match AMS record (CLI-015); contact info is outdated
  - Agent should flag for manual verification rather than auto-routing

## Required Steps

1. **Retrieve lead details** — `GET /leads/{id}` to get name, source, contact info, and initial score
2. **Check for existing client** — `GET /clients?last_name=...&email=...` to determine if this is a new or returning client
3. **Qualify the lead:**
   - If existing client: link to their AMS record, note cross-sell opportunity
   - If new: assess based on score, source quality, and coverage type requested
4. **Assign to producer** — Update lead with assigned producer based on:
   - Coverage type (personal vs commercial)
   - Geographic territory
   - Existing relationship (same producer as referring client)
5. **Send acknowledgment** — `POST /messages/send` to the lead with response time expectation
6. **Create follow-up task** — `POST /tasks` in AMS for the assigned producer

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| Lead correctly classified | New vs existing client determined accurately |
| Existing client linked | If existing, lead connected to the correct AMS client record |
| Producer assigned | Lead routed to appropriate producer with reasoning |
| Acknowledgment sent | Lead received a response within the workflow |
| Follow-up scheduled | Task created for the assigned producer |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Classification accuracy | 30% | Correctly identified new vs existing client |
| Routing logic | 25% | Assigned to the right producer for the right reasons |
| Data quality | 20% | Lead record updated with client link, notes, and status |
| Communication | 15% | Acknowledgment is professional and sets expectations |
| Efficiency | 10% | Minimal API calls; didn't over-research a simple lead |

## E&O Traps

- **None for basic qualification** — this is pre-sales activity with no coverage decisions
- However, the agent should NOT quote premiums or promise coverage in the acknowledgment

## Failure Modes

- Treating an existing client as a new lead (creating duplicate records)
- Not recognizing the Foster/Foster-Blake name mismatch (alternative entry point)
- Auto-routing a stale-contact lead without flagging the data quality issue
- Assigning to the wrong producer (e.g., commercial producer for a personal umbrella request)
- Not sending any acknowledgment (lead goes cold)
