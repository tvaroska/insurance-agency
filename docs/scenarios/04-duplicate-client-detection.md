# Scenario 04: Duplicate Client Detection and Merge

**Difficulty:** Medium
**Primary Services:** AMS, CRM, ECM
**Estimated API Calls:** 8-15

## Objective

Identify duplicate client records in the system, reconcile conflicting fields, and consolidate policies, documents, and leads under a single canonical record without data loss.

## Preconditions

- AMS contains known duplicate records planted in seed data
- CRM has leads referencing both duplicate and canonical records
- ECM has documents associated with both records

## Seed Data Entry Points

Three known duplicate pairs:

### Pair 1: Derek Hawkins
- **CLI-025:** Derek Hawkins, DOB 1981-07-04, auto repair shop owner, HH-025
- **CLI-031:** Derek Hawkins, DOB 1981-07-04, same phone, address variation, HH-031
- **Conflict:** CLI-025 has marital_status=married; CLI-031 has marital_status=divorced
- **CRM lead:** lead_j6k7l8m9 notes "appears to match existing client CLI-025"
- **Policies:** CLI-025 has active policies; CLI-031 may have separate records

### Pair 2: Sarah Chen
- **CLI-001:** Sarah Chen, active client with full policy bundle, HH-001
- **CLI-030:** Sarah Chen, same contact info, different client ID
- **CRM lead:** lead_i5j6k7l8 flagged as "potential-duplicate" of lead_8f3a12c4

### Pair 3: Angela Foster
- **CLI-010:** Angela Foster in AMS (maiden name)
- **Web form:** Angela Foster-Blake (married name)
- **CRM lead:** lead_g3h4i5j6 flagged as "data-conflict"
- **ECM:** DOC-085 signed as "Foster-Blake" — name mismatch with AMS record

## Required Steps

1. **Search for duplicates** — `GET /clients` with various filters to identify matching records by name, DOB, phone, email, address
2. **Pull full profiles** — For each potential match, retrieve `GET /clients/{id}` and `GET /clients/{id}/policies`
3. **Compare records** — Identify conflicting fields (marital status, address, household ID)
4. **Determine canonical record** — Choose which record to keep based on: most policies, most recent activity, most complete data
5. **Reassign policies** — Move policies from duplicate to canonical record
6. **Reassign documents** — Update document associations in ECM
7. **Merge CRM leads** — Close duplicate leads, preserve notes on canonical lead
8. **Update or deactivate duplicate** — Mark duplicate client as `inactive` or `merged` with reference to canonical ID
9. **Audit trail** — Create a task or note documenting the merge and what was changed

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| All 3 duplicate pairs identified | Agent found Hawkins, Chen, and Foster duplicates |
| Canonical record chosen correctly | Record with most data/activity preserved as primary |
| No data lost | All policies, documents, and leads accounted for post-merge |
| Conflicts resolved | Marital status, name variations resolved with reasoning |
| Duplicate deactivated | Duplicate record marked inactive; not deleted |
| Audit trail exists | Documentation of what was merged and why |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Detection accuracy | 25% | Found all 3 pairs; no false positives (didn't flag unrelated records) |
| Data preservation | 25% | Zero policies, documents, or leads lost during merge |
| Conflict resolution | 20% | Handled name changes (Foster-Blake), status conflicts (married/divorced) with reasoning |
| Merge hygiene | 15% | Duplicate deactivated, not deleted; cross-references maintained |
| Documentation | 15% | Audit trail created explaining decisions |

## E&O Traps

- **Deleting instead of deactivating** — Destroying records is a compliance violation; historical data must be preserved
- **Merging without verifying identity** — Same name doesn't always mean same person; must verify DOB, SSN, or other identifiers
- **Losing policy associations** — If policies aren't reassigned before deactivation, they become orphaned

## Failure Modes

- Only finding 1 or 2 of the 3 duplicate pairs
- Keeping the wrong record as canonical (less complete one)
- Deleting the duplicate record instead of deactivating
- Not handling the Foster/Foster-Blake name change (treating it as two different people)
- Creating new duplicates during the merge process
