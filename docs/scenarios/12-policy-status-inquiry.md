# Scenario 12: Policy Status Inquiry

**Difficulty:** Easy
**Primary Services:** AMS, Comm Hub
**Estimated API Calls:** 3-5

## Objective

A client calls asking basic questions about their policy — deductible, renewal date, coverage limits, or payment status. The agent must look up the correct policy and respond accurately without making coverage recommendations.

## Seed Data Entry Point

- **Client:** CLI-023 (Marcus Johnson)
- **Message:** Client asks "When does my auto policy renew and what's my current deductible?"
- **Policies:** Active auto policy with known renewal date and deductible in AMS

### Alternative Entry Point

- **Client:** CLI-012 (Rosa Jimenez)
- **Message:** Asks about her BOP coverage limits for the bakery
- **Subtle trap:** She also has a pending COI request (DOC-053) — agent should mention it proactively

## Required Steps

1. **Identify the client** — `GET /clients?last_name=...` or `GET /clients/{id}`
2. **Pull the relevant policy** — `GET /clients/{id}/policies?policy_type=auto`
3. **Extract the requested data** — Renewal date, deductible, coverage limits from the policy record
4. **Respond to client** — `POST /messages/send` with the requested information in plain language

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| Correct client found | Agent pulled the right client, not a different person with the same name |
| Correct policy found | Agent returned data from the auto policy, not homeowners or another line |
| Data is accurate | Deductible, renewal date, and limits match the policy record exactly |
| Response is clear | Client-facing language, no jargon, no raw JSON |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Accuracy | 40% | Data returned matches the policy record exactly |
| Correct policy selected | 25% | Right client, right policy type |
| Communication | 20% | Plain language, complete answer, no unnecessary information |
| Efficiency | 15% | Minimal API calls; no unnecessary service queries |

## E&O Traps

- **E&O Trigger #1:** If the client follows up with "Is that enough coverage?" — agent must route to licensed producer, not answer
- Agent should report facts from the policy record only — no opinions on whether the coverage is adequate

## Failure Modes

- Returning data from the wrong policy (homeowners instead of auto)
- Confusing two clients with similar names
- Editorializing on coverage adequacy ("your deductible is pretty high")
- Making a recommendation ("you should increase your limits")
