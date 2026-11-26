#!/usr/bin/env bash
# Canonical verification gate and subtarget runner for insurance-agency.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

export PATH="${HOME}/.bun/bin:${HOME}/.local/bin:${PATH}"

if [[ -f "specs/ast.rules.yaml" ]]; then
  if command -v ast-grep >/dev/null 2>&1; then
    ast-grep scan --rule specs/ast.rules.yaml
  elif [[ "${ALLOW_MISSING_AST_GREP:-0}" == "1" ]]; then
    echo "WARN: ast-grep not found; skipping specs/ast.rules.yaml (ALLOW_MISSING_AST_GREP=1)." >&2
  else
    echo "ERROR: ast-grep not found in PATH (set ALLOW_MISSING_AST_GREP=1 to opt out)." >&2
    exit 1
  fi
fi

python3 scripts/check_docs_and_specs.py

if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not found in PATH or ~/.bun/bin." >&2
  exit 1
fi

if [[ ! -d "node_modules" ]]; then
  bun install --frozen-lockfile
fi
if [[ ! -d "services/ams/src/generated/prisma" ]]; then
  bun run db:generate
fi

if [[ $# -eq 0 ]]; then
  bun run showcase:check
  bun run typecheck
  if [[ -d "packages/shared" ]]; then
    (cd "packages/shared" && bun test)
  fi
  svc_pids=()
  for svc in services/*/; do
    if [[ -f "${svc}/package.json" ]]; then
      (cd "${svc}" && bun test) &
      svc_pids+=("$!")
    fi
  done
  for pid in "${svc_pids[@]}"; do
    wait "${pid}"
  done
  bun test eval/__tests__/ eval/*/__tests__/
  bun test tests/*.test.ts
  bun test tests/integration/*.test.ts
  bun test tests/conformance
  bun eval/validate-harness.ts
  if [[ -x "${HOME}/.venvs/evergreen-inspect/bin/pytest" ]]; then
    PYTHONDONTWRITEBYTECODE=1 "${HOME}/.venvs/evergreen-inspect/bin/pytest" -p no:cacheprovider eval/inspect/tests
  elif [[ "${ALLOW_MISSING_PYTEST_VENV:-0}" == "1" ]]; then
    echo "WARN: ${HOME}/.venvs/evergreen-inspect/bin/pytest not found; skipping pytest (ALLOW_MISSING_PYTEST_VENV=1)." >&2
  else
    echo "ERROR: ${HOME}/.venvs/evergreen-inspect/bin/pytest not found (set ALLOW_MISSING_PYTEST_VENV=1 to opt out)." >&2
    exit 1
  fi
  exit 0
fi

SUBTARGET="$1"
shift
case "${SUBTARGET}" in
  ams|rater|crm|ecm|comm|carrier-summit|carrier-coastal|claims)
    cd "${REPO_ROOT}/services/${SUBTARGET}"
    exec bun test "$@"
    ;;
  shared)
    cd "${REPO_ROOT}/packages/shared"
    exec bun test "$@"
    ;;
  eval)
    exec bun test eval/__tests__/ eval/*/__tests__/ "$@"
    ;;
  tests|contract|hygiene)
    exec bun test tests/*.test.ts "$@"
    ;;
  integration)
    exec bun test tests/integration/*.test.ts "$@"
    ;;
  conformance)
    exec bun test tests/conformance "$@"
    ;;
  pytest|inspect-test)
    exec env PYTHONDONTWRITEBYTECODE=1 "${HOME}/.venvs/evergreen-inspect/bin/pytest" -p no:cacheprovider eval/inspect/tests "$@"
    ;;
  showcase-check|showcase:check)
    exec bun run showcase:check "$@"
    ;;
  typecheck)
    exec bun run typecheck "$@"
    ;;
  showcase)
    exec bun run showcase "$@"
    ;;
  validate-harness)
    exec bun eval/validate-harness.ts "$@"
    ;;
  inspect-baseline)
    exec "${HOME}/.venvs/evergreen-inspect/bin/python" eval/inspect/run_baseline.py "$@"
    ;;
  inspect-summary)
    exec "${HOME}/.venvs/evergreen-inspect/bin/python" eval/inspect/summarize_inspect.py "$@"
    ;;
  *)
    exec bun test "${SUBTARGET}" "$@"
    ;;
esac
