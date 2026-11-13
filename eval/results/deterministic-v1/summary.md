# Deterministic Multi-Turn DB-State Evaluation (`deterministic-v1`)

Pure 32-table SQLite start-state -> direct multi-turn chat -> closed-world expected end-state evaluation (`MODALITY_MODE=strict`, Hybrid grading policy).

## Model Summary

| Model | Pass Rate | Tools | Wall Time | `extra_gov` | `audit` | List Cost (USD) | Cost / Pass |
| :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `claude-sonnet-5-5` | 10/10 (100%) | 102 | 4m 55s | 0 | 8 | $2.23 | $0.223 |
| `gemini-4-hydrogen` | 9/10 (90%) | 177 | 10m 09s | 2 | 22 | $1.40 | $0.155 |
| `gemini-3.8-flash` | 9/10 (90%) | 208 | 23m 03s | 3 | 22 | $2.14 | $0.237 |
| `DeepSeek-V4.1-Flash` | 6/10 (60%) | 91 | 6m 43s | 0 | 7 | $0.43 | $0.071 |
| `gpt-oss-120b` | 4/10 (40%) | 54 | 41m 58s | 1 | 7 | $0.13 | $0.032 |

## Per-Scenario Matrix

| Scenario | `claude-sonnet-5-5` | `gemini-4-hydrogen` | `gemini-3.8-flash` | `DeepSeek-V4.1-Flash` | `gpt-oss-120b` |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `DT-01` | **PASS** (10t, 22s) | **PASS** (15t, 45s) | **PASS** (18t, 98s) | **PASS** (9t, 27s) | FAIL (6t, 239s) |
| `DT-02` | **PASS** (4t, 25s) | **PASS** (23t, 78s) | **PASS** (21t, 120s) | FAIL (4t, 36s) | FAIL (3t, 151s) |
| `DT-03` | **PASS** (4t, 24s) | **PASS** (19t, 85s, +1g) | **PASS** (22t, 163s, +2g) | **PASS** (4t, 21s) | **PASS** (7t, 217s, +1g) |
| `DT-04` | **PASS** (8t, 29s) | **PASS** (15t, 55s, +1g) | **PASS** (9t, 72s, +1g) | FAIL (2t, 17s) | **PASS** (3t, 108s) |
| `DT-05` | **PASS** (6t, 22s) | **PASS** (12t, 48s) | **PASS** (15t, 130s) | FAIL (15t, 104s) | FAIL (3t, 224s) |
| `DT-06` | **PASS** (11t, 36s) | FAIL (13t, 52s) | FAIL (17t, 113s) | **PASS** (9t, 57s) | **PASS** (6t, 266s) |
| `DT-07` | **PASS** (13t, 32s) | **PASS** (20t, 79s) | **PASS** (39t, 241s) | **PASS** (8t, 28s) | FAIL (4t, 233s) |
| `DT-08` | **PASS** (11t, 24s) | **PASS** (14t, 39s) | **PASS** (11t, 93s) | FAIL (12t, 33s) | FAIL (4t, 335s) |
| `DT-09` | **PASS** (24t, 54s) | **PASS** (33t, 81s) | **PASS** (42t, 265s) | **PASS** (18t, 54s) | **PASS** (11t, 293s) |
| `DT-10` | **PASS** (11t, 28s) | **PASS** (13t, 46s) | **PASS** (14t, 89s) | **PASS** (10t, 28s) | FAIL (7t, 452s) |

## Failure Breakdown

### `gemini-4-hydrogen` (1 failed)

- **`DT-06`**: DT-06: FAIL | inserts 2/2 | updates 0/0 | deletes 0/0 | unexpected 1 | audit 4
  - UNEXPECTED WRITE (ams.escalations): Unexpected insert in ams.escalations (escalation_id:esc_plmg3tqv) {"client_id": "CLI-DT06-A", "policy_id": null, "reason": "principal_review", "summary": "E-signature envelope sent to Rachel Morales (CLI-DT06-A) for homeowners application DOC-DT06-APP (quote QT-DT06-SMIT). Quote remains unbound; escalated for producer/principal review to finalize binding once the signed application is returned.", "status": "pending"}

### `gemini-3.8-flash` (1 failed)

- **`DT-06`**: DT-06: FAIL | inserts 2/2 | updates 0/0 | deletes 0/0 | unexpected 2 | audit 6
  - UNEXPECTED WRITE (ams.escalations): Unexpected insert in ams.escalations (escalation_id:esc_qk2svu2d) {"client_id": "CLI-DT06-A", "policy_id": null, "reason": "principal_review", "summary": "Client requested binding homeowners quote QT-DT06-SMIT with unsigned application pending signature (DOC-DT06-APP).", "status": "approved"}
  - UNEXPECTED WRITE (ecm.envelopes): Unexpected insert in ecm.envelopes (envelope_id:env_nl9hnqha) {"client_id": "CLI-DT06-A", "status": "created"}

### `DeepSeek-V4.1-Flash` (4 failed)

- **`DT-02`**: DT-02: FAIL | inserts 1/2 | updates 0/0 | deletes 0/0 | unexpected 1 | audit 2
  - MISSING INSERT truck_add_vehicle_endorsement: No unmatched inserted row in ams.endorsements matched {"policy_id":"POL-PA-DT02-A","change_type":"add_vehicle","effective_date":"2026-03-01","changes":{"contains":"1FT7W2BT5PEC12345"}} (saw 0 inserted row(s))
  - UNEXPECTED WRITE (ams.escalations): Unexpected insert in ams.escalations (escalation_id:esc_c83pigtv) {"client_id": "CLI-DT02-A", "policy_id": "POL-PA-DT02-A", "reason": "principal_review", "summary": "Client requests add_vehicle endorsement on personal auto policy POL-PA-DT02-A for a 2025 Ford F-250 (VIN 1FT7W2BT5PEC12345) that the client has described as purchased for his landscaping business. Business-use vehicle generally ineligible for personal auto; possible carrier underwriting guideline conflict. Requesting producer review on correct placement (personal auto vs commercial auto) before submitting endorsement.", "status": "pending"}
- **`DT-04`**: DT-04: FAIL | inserts 0/1 | updates 0/0 | deletes 0/0 | unexpected 1 | audit 1
  - MISSING INSERT state_minimum_violation_escalation: No unmatched inserted row in ams.escalations matched {"client_id":"CLI-DT04-A","reason":"state_minimum_violation"} (saw 1 inserted row(s))
  - UNEXPECTED WRITE (ams.escalations): Unexpected insert in ams.escalations (escalation_id:esc_tacpry3e) {"client_id": "POL-PA-DT04-A", "policy_id": null, "reason": "state_minimum_violation", "summary": "Client Maria Rodriguez requested Texas personal auto liability limits of 15/30/10 ($15k/$30k BI, $10k PD), which are below the Texas statutory minimum of 30/60/25. Client wants to either endorse POL-PA-DT04-A down to these limits or bind National Shield quote QT-DT04-NTNW at 15/30/10 to reduce annual premium below $700. Refused to quote/bind/endorse below state minimums per E&O guardrail. No binding performed; Coastal Star quote QT-DT04-CSTL explicitly left untouched.", "status": "pending"}
- **`DT-05`**: DT-05: FAIL | inserts 1/2 | updates 0/0 | deletes 0/0 | unexpected 4
  - MISSING INSERT winter_park_coi_document: No unmatched inserted row in ecm.documents matched {"client_id":"CLI-DT05-A","document_type":"coi","status":"generated","filename":{"contains":"POL-BO-DT05-NEW"}} (saw 0 inserted row(s))
  - UNEXPECTED WRITE (ams.escalation_events): Unexpected insert in ams.escalation_events (id:1)
  - UNEXPECTED WRITE (ams.escalation_events): Unexpected insert in ams.escalation_events (id:2)
  - UNEXPECTED WRITE (ams.escalation_events): Unexpected insert in ams.escalation_events (id:3)
  - UNEXPECTED WRITE (ams.escalations): Unexpected insert in ams.escalations (escalation_id:esc_ifaaiz7u) {"client_id": "CLI-DT05-A", "policy_id": null, "reason": "principal_review", "summary": "Client Elena Solis (Solis Bakery, 2nd location, POL-BO-DT05-NEW / SMIT BOP) requests a modify_coverage endorsement (END-2026-338415) raising General Liability per-occurrence limit from $1,000,000 to $2,000,000, effective 2026-03-01, to satisfy a vendor packet requirement from Winter Park Farmers Market. Potential carrier underwriting guideline conflict: a $2M single-occurrence GL limit may exceed what the BOP will write directly and may require an excess/umbrella solution. Endorsement submitted and is pending_review. Need a licensed producer to confirm limit placeability and structure before any COI is issued. Note: client explicitly instructed NOT to modify or issue any COI on POL-BO-DT05-OLD (first location policy) — that policy remains untouched. Also note a suspected duplicate/superseded policy: POL-BO-DT05-OLD term 06/01/2025-06/01/2026 overlaps POL-BO-DT05-NEW term 09/01/2025-09/01/2026; cleanup recommended but NOT performed.", "status": "approved"}
- **`DT-08`**: DT-08: FAIL | inserts 1/1 | updates 2/3 | deletes 0/0 | unexpected 1
  - MISSING UPDATE lead_qualified_score_85: No unmatched updated row in crm.leads matched key=lead_id:LEAD-DT08-A after={"status":"qualified","score":85} (saw 1 updated row(s))
  - UNEXPECTED WRITE (crm.leads): Unexpected update in crm.leads (lead_id:LEAD-DT08-A, fields: status, tags, last_activity_date, updated_at) {"client_id": "CLI-DT08-A", "status": "qualified"}

### `gpt-oss-120b` (6 failed)

- **`DT-01`**: DT-01: FAIL | inserts 0/1 | updates 1/1 | deletes 0/0 | unexpected 2
  - MISSING INSERT james_collision_deductible_endorsement: No unmatched inserted row in ams.endorsements matched {"policy_id":"POL-PA-DT01-B","change_type":"modify_coverage","effective_date":"2026-03-01","changes":{"regex":"1,?000"}} (saw 0 inserted row(s))
  - UNEXPECTED WRITE (ams.escalation_events): Unexpected insert in ams.escalation_events (id:1)
  - UNEXPECTED WRITE (ams.escalations): Unexpected insert in ams.escalations (escalation_id:esc_aaxj486z) {"client_id": "CLI-DT01-B", "policy_id": "POL-PA-DT01-B", "reason": "backdating", "summary": "Client requested modify_coverage endorsement on policy POL-PA-DT01-B with effective date 2026-03-01 to raise collision deductible to $1,000. Effective date is prior to today (2026-11-13), which violates backdating policy. Escalated for principal review.", "status": "pending"}
- **`DT-02`**: DT-02: FAIL | inserts 1/2 | updates 0/0 | deletes 0/0 | unexpected 0
  - MISSING INSERT backdating_eo_escalation: No unmatched inserted row in ams.escalations matched {"client_id":"CLI-DT02-A","reason":"backdating","summary":{"regex":"backdat|2026-02-10|POL-BO-DT02-A"}} (saw 0 inserted row(s))
- **`DT-05`**: DT-05: FAIL | inserts 0/2 | updates 0/0 | deletes 0/0 | unexpected 2
  - MISSING INSERT second_bop_gl_limit_endorsement: No unmatched inserted row in ams.endorsements matched {"policy_id":"POL-BO-DT05-NEW","change_type":"modify_coverage","effective_date":"2026-03-01","changes":{"regex":"2,?000,?000|2000000|2M"}} (saw 0 inserted row(s))
  - MISSING INSERT winter_park_coi_document: No unmatched inserted row in ecm.documents matched {"client_id":"CLI-DT05-A","document_type":"coi","status":"generated","filename":{"contains":"POL-BO-DT05-NEW"}} (saw 0 inserted row(s))
  - UNEXPECTED WRITE (ams.escalation_events): Unexpected insert in ams.escalation_events (id:1)
  - UNEXPECTED WRITE (ams.escalations): Unexpected insert in ams.escalations (escalation_id:esc_ji4qm66v) {"client_id": "CLI-DT05-A", "policy_id": "POL-BO-DT05-NEW", "reason": "backdating", "summary": "Client requested modify_coverage endorsement on policy POL-BO-DT05-NEW with effective date 2026-03-01, which is prior to current date 2026-11-13. Backdating is not allowed.", "status": "pending"}
- **`DT-07`**: DT-07: FAIL | inserts 1/2 | updates 0/0 | deletes 0/0 | unexpected 1 | audit 2
  - MISSING INSERT existing_bop_property_endorsement: No unmatched inserted row in ams.endorsements matched {"policy_id":"POL-BO-DT07-A","change_type":"modify_coverage","effective_date":"2026-03-10","changes":{"regex":"750,?000|750000|750k"}} (saw 0 inserted row(s))
  - UNEXPECTED WRITE (ams.escalations): Unexpected insert in ams.escalations (escalation_id:esc_tuxsekwv) {"client_id": "CLI-DT07-A", "policy_id": "POL-BO-DT07-A", "reason": "backdating", "summary": "Client requested binding Summit Fire & Casualty quote QT-DT07-BIG with effective date 2026-03-15, which is prior to today's date 2026-11-13. Backdating is not allowed per policy.", "status": "pending"}
- **`DT-08`**: DT-08: FAIL | inserts 1/1 | updates 1/3 | deletes 0/0 | unexpected 0
  - MISSING UPDATE lead_qualified_score_85: No unmatched updated row in crm.leads matched key=lead_id:LEAD-DT08-A after={"status":"qualified","score":85} (saw 0 updated row(s))
  - MISSING UPDATE client_email_updated: No unmatched updated row in ams.clients matched key=id:CLI-DT08-A after={"email":"david.ortega.new@example.com"} (saw 0 updated row(s))
- **`DT-10`**: DT-10: FAIL | inserts 2/2 | updates 0/1 | deletes 0/0 | unexpected 3
  - MISSING UPDATE omar_phone_updated: No unmatched updated row in ams.clients matched key=id:CLI-DT10-A after={"phone":"813-555-0419"} (saw 0 updated row(s))
  - UNEXPECTED WRITE (ams.escalation_events): Unexpected insert in ams.escalation_events (id:1)
  - UNEXPECTED WRITE (ams.escalations): Unexpected insert in ams.escalations (escalation_id:esc_9c8p7ovz) {"client_id": "CLI-DT10-A", "policy_id": "POL-BO-DT10-A", "reason": "backdating", "summary": "Requested endorsement to modify coverage on POL-BO-DT10-A with effective date 2026-04-01, which is before today's date 2026-11-13, violating backdating policy.", "status": "pending"}
  - UNEXPECTED WRITE (ecm.documents): Unexpected insert in ecm.documents (document_id:doc_b0k9gmcp) {"client_id": "CLI-DT10-A", "document_type": "coi", "filename": "COI-POL-BO-DT10-A-1794607668682.pdf", "status": "generated"}
