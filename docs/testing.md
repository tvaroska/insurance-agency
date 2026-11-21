# Evergreen Insurance Agency — Testing

## Test Command

```bash
# Full test suite (showcase:check, shared, 8 services in parallel, eval, contract/hygiene, integration, pytest; or ./scripts/gate.sh in standalone clones):
../bin/gate test insurance-agency

# Fast targeted subtargets:
../bin/gate test insurance-agency <service>        # ams | rater | crm | ecm | comm | carrier-summit | carrier-coastal | claims
../bin/gate test insurance-agency eval             # eval/__tests__/ and eval/*/__tests__/
../bin/gate test insurance-agency integration      # tests/integration/*.test.ts
../bin/gate test insurance-agency pytest           # eval/inspect/tests
../bin/gate test insurance-agency validate-harness # zero-daemon in-process 20-scenario harness validation
```

## Strategy

- Unit tests for business logic
- Integration tests for API endpoints / data flows
- E2E tests for critical user journeys

## Conventions

- Test files live alongside source files (or in `tests/` directory)
- Name tests descriptively: `test_{what}_{condition}_{expected}`
- Each new feature must include tests before marking complete

## How to Add Tests

1. Identify what to test (happy path, edge cases, error cases)
2. Write test following existing patterns in the codebase
3. Run tests to verify
4. Ensure no existing tests break
