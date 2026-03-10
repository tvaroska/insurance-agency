# Scenario 15: Commission Reconciliation

**Difficulty:** Easy
**Primary Services:** AMS
**Estimated API Calls:** 3-6

## Objective

The agency manager asks for a commission summary for a specific carrier or time period. The agent must pull commission data, verify it against active policies, and flag any discrepancies.

## Seed Data Entry Point

- **Request:** "Show me all commissions from Summit Fire (SMIT) for the last quarter"
- **AMS endpoint:** `GET /accounting/commissions?carrier_code=SMIT&date_from=...&date_to=...`
- **Policies:** Multiple active SMIT policies across clients (Chen family, Thompson, others)

### Alternative Entry Point

- **Request:** "What's our total commission income across all carriers this month?"
- **Action:** Pull commissions for all carriers, aggregate by carrier, present a summary table

## Required Steps

1. **Pull commission records** — `GET /accounting/commissions` with appropriate filters (carrier, date range)
2. **Cross-reference with policies** — For each commission, verify the associated policy exists and is active via `GET /clients/{id}/policies`
3. **Identify discrepancies:**
   - Commissions for cancelled/expired policies (should have stopped)
   - Active policies with no commission record (missing revenue)
   - Commission rate anomalies (significantly different from standard carrier rates)
4. **Summarize** — Present totals by carrier, policy type, or producer as requested
5. **Flag issues** — If any discrepancies found, create tasks in AMS

## Expected Outcomes

| Outcome | Pass Criteria |
|---------|---------------|
| Data retrieved | Commission records pulled for the correct carrier/period |
| Cross-referenced | Commissions verified against active policy records |
| Totals accurate | Sums are mathematically correct |
| Discrepancies flagged | Any mismatches between commissions and policy status noted |
| Summary is clear | Presented in a readable table format |

## Scoring Criteria

| Dimension | Weight | Criteria |
|-----------|--------|----------|
| Data accuracy | 35% | Correct filters applied; totals are accurate |
| Cross-referencing | 25% | Commissions matched to policies; orphaned records identified |
| Presentation | 20% | Clear table format with carrier, policy, amount, and rate |
| Discrepancy detection | 10% | Flagged any mismatches between commission and policy status |
| Efficiency | 10% | Used bulk queries instead of per-policy lookups where possible |

## E&O Traps

- **None** — this is an internal accounting task with no client-facing coverage decisions
- However, agent should not share commission rates or amounts with clients if asked (proprietary business data)

## Failure Modes

- Using wrong date range or carrier code filter
- Not cross-referencing with policies (just reporting raw commission data without validation)
- Arithmetic errors in totals
- Missing pagination (only returning first page of results)
- Reporting commissions for cancelled policies without flagging the issue
