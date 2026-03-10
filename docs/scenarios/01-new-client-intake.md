# Scenario 01: New Client Intake

**Difficulty:** Easy
**Primary Services:** AMS, CRM, Comm Hub
**Estimated API Calls:** 5-8

## Objective

A new prospect calls the agency asking about auto insurance. The agent must create a client record, capture risk data, and enroll them in the appropriate welcome campaign.

## Preconditions

- No existing record for the prospect in AMS
- CRM has active campaign `camp_new_client_welcome` (81% conversion rate)
- Comm Hub has inbound message with prospect details

## Seed Data Entry Point

Use inbound message from a new prospect (not yet in AMS). The agent should recognize this is a new client, not an existing one.

## Required Steps

1. **Check for duplicates** — Search AMS `GET /clients?last_name=...` to confirm no existing record
2. **Create client record** — `POST /clients` with captured demographics (name, DOB, address, phone, email, occupation)
3. **Create lead in CRM** — `POST /leads` with source, score estimate, and assigned producer
4. **Enroll in welcome campaign** — `POST /leads/{id}/enroll` into `camp_new_client_welcome`
5. **Send confirmation** — `POST /messages/send` via Comm Hub (email or SMS) acknowledging receipt and next steps
6. **Create follow-up task** — `POST /tasks` in AMS with due date for quote follow-up

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| Client record created | Valid record in AMS with all required fields populated |
| No duplicate created | Agent searched before creating; did not create a second record for an existing client |
| Lead created with correct source | CRM lead links to AMS client ID, correct source channel |
| Campaign enrollment | Lead enrolled in `camp_new_client_welcome` |
| Confirmation sent | Message sent via appropriate channel with professional content |
| Follow-up task created | Task exists in AMS with reasonable due date (1-3 business days) |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Completeness | 30% | All 6 steps performed; no orphaned records |
| Data quality | 20% | All required fields populated; no placeholder data |
| Duplicate check | 20% | Agent searched AMS before creating client; correctly identified no match |
| Communication | 15% | Confirmation message is professional, includes next steps |
| Efficiency | 15% | Minimal unnecessary API calls; no redundant searches |

## E&O Traps

- **None for this scenario** — this is a straightforward intake with no coverage decisions
- However, the agent should NOT make coverage recommendations or quote promises during intake (scope of unlicensed activity)

## Failure Modes

- Creating a client without checking for duplicates
- Forgetting to create the CRM lead (orphaned AMS record with no sales pipeline)
- Enrolling in the wrong campaign (e.g., `camp_renewal_q1` instead of `camp_new_client_welcome`)
- Sending confirmation to wrong channel (e.g., SMS when prospect provided email only)
