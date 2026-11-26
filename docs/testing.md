# Evergreen Insurance Agency — Testing

## Canonical Gate & Subtargets

All verification runs through [`scripts/gate.sh`](../scripts/gate.sh) (or `../bin/gate test insurance-agency [subtarget]` from the parent workspace):

```bash
# Full gate (runs every stage below in order):
./scripts/gate.sh

# Fast targeted subtargets:
./scripts/gate.sh <service>          # ams | rater | crm | ecm | comm | carrier-summit | carrier-coastal | claims
./scripts/gate.sh shared             # packages/shared unit tests
./scripts/gate.sh eval               # eval/__tests__/ and eval/*/__tests__/
./scripts/gate.sh hygiene            # tests/*.test.ts (OpenAPI route contract + repo hygiene; aliases: tests, contract)
./scripts/gate.sh integration        # tests/integration/*.test.ts (multi-service Prisma/HTTP workflows)
./scripts/gate.sh conformance        # tests/conformance (black-box HTTP, OpenAPI, runtime & headless portal smokes)
./scripts/gate.sh validate-harness   # eval/validate-harness.ts (zero-daemon in-process 20-scenario harness validation)
./scripts/gate.sh pytest             # eval/inspect/tests (Python Inspect/METR/OpenEnv/audit tests; alias: inspect-test)
./scripts/gate.sh showcase:check     # bun run showcase:check (Executive Showcase preflight; alias: showcase-check)
./scripts/gate.sh typecheck          # bun run typecheck (strict tsc --noEmit across all 12 tsconfigs)
```

## Gate Stages (in execution order)

Every invocation of `scripts/gate.sh` first runs the static contract guards, then executes the requested subtarget (or all stages when called with no arguments):

| Stage | Command | Scope |
| :--- | :--- | :--- |
| AST contract | `ast-grep scan --rule specs/ast.rules.yaml` | Microservice import isolation, Prisma raw-SQL guard, shell-spawn guard, claims port boundary, seeded RNG enforcement |
| Docs & specs check | `python3 scripts/check_docs_and_specs.py` | Required governance files, all 8 named OpenAPI YAML specs (`specs/*.yaml`), and relative Markdown links |
| Showcase preflight | `bun run showcase:check` | Validates Executive Showcase wiring and static assets |
| Strict typecheck | `bun run typecheck` | `tsc --noEmit` across root, `packages/shared`, and all 8 service + portal UI `tsconfig*.json` files |
| Shared unit tests | `(cd packages/shared && bun test)` | Auth/JWT scopes, compliance firewall, `/sim/*` control plane, pagination, error handling, request logging |
| Service unit tests | `(cd services/<svc> && bun test)` (8 in parallel) | Route and business logic tests for `ams`, `rater`, `crm`, `ecm`, `comm`, `carrier-summit`, `carrier-coastal`, `claims` |
| Eval unit tests | `bun test eval/__tests__/ eval/*/__tests__/` | Output/trace/rubric/state-diff/state-contract evaluators, rescoring, baseline agent, and showcase generator |
| Contract & hygiene | `bun test tests/*.test.ts` | Bidirectional OpenAPI route parity (`tests/openapi-route-contract.test.ts`) and repository/seed/CRITICAL.md hygiene (`tests/repo-hygiene.test.ts`) |
| Integration tests | `bun test tests/integration/*.test.ts` | Cross-service HTTP/Prisma workflows (`content-auditor`, `pivot-agent`, `retention`, `underwriting`) |
| Conformance suite | `bun test tests/conformance` | Black-box HTTP, OpenAPI request/response schema, runtime control-plane, and headless portal DOM smoke tests across all 8 services |
| Harness validation | `bun eval/validate-harness.ts` | In-process 20-scenario benchmark harness validation across all anchors without external daemons |
| Python adapter tests | `PYTHONDONTWRITEBYTECODE=1 pytest -p no:cacheprovider eval/inspect/tests` | Inspect AI, METR, OpenEnv, deterministic sweep, blind-audit scoring, and summary aggregation tests |

## Conventions

- **Unit tests** live alongside source code in `packages/shared/src/__tests__/*.test.ts`, `services/<svc>/src/__tests__/*.test.ts`, `eval/__tests__/*.test.ts`, and `eval/inspect/tests/test_*.py`.
- **Black-box conformance tests** live under [`tests/conformance/`](../tests/conformance/README.md), import only from `../harness` (never from `services/` or `packages/`), and verify HTTP behavior, OpenAPI schemas (`contract.check(res)`), and `/sim/*` database diffs.
- **Python tests** must run with `PYTHONDONTWRITEBYTECODE=1` and `-p no:cacheprovider` so `__pycache__` directories are not left in the working tree (enforced by `tests/repo-hygiene.test.ts`).
- **Adding tests:** cover happy paths, validation/auth error paths, and DB state invariants, then run the matching `./scripts/gate.sh <subtarget>` followed by `./scripts/gate.sh` before finishing.
