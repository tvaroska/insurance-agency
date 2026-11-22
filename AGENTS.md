# Evergreen Insurance Agency (`AGENTS.md`)

> **Scope Guardrail (Agent Evaluation & Training Gym, Not Production SaaS):** Evergreen is a deterministic multi-service benchmark and RL/eval environment (`v0.9`, simulated clock frozen at `2026-10-14T12:00:00.000Z`), **not** production brokerage software. Isolated SQLite databases, seeded anomalies, and deterministic carrier-portal state transitions exist intentionally to test agent tool use, state verification, and E&O escalation; evaluate changes on benchmark validity, determinism, and anti-reward-hacking rigor rather than production SaaS infrastructure checklists.

## 1. Services & Execution

Use `bun run showcase` for zero-Docker local execution of all 8 services (`:3000`–`:3007`) and the Executive Workbench (`http://localhost:3000/`), or `docker compose` for containerized execution:

```bash
# Canonical single-command runner (runs showcase:check, shared, 8 services in parallel, eval, contract, integration, conformance, and pytest; or run ./scripts/gate.sh directly in standalone clones):
../bin/gate test insurance-agency

# Fast targeted subtargets (~0.5s–1.5s; conformance ~2.5m):
../bin/gate test insurance-agency claims               # single service: ams|rater|crm|ecm|comm|carrier-summit|carrier-coastal|claims
../bin/gate test insurance-agency eval                 # eval/__tests__/ + eval/*/__tests__/
../bin/gate test insurance-agency integration          # tests/integration/*.test.ts
../bin/gate test insurance-agency conformance          # tests/conformance (full HTTP/spec conformance suite)
../bin/gate test insurance-agency pytest               # eval/inspect/tests
../bin/gate test insurance-agency showcase-check       # bun run showcase:check
../bin/gate test insurance-agency validate-harness     # zero-daemon in-process 20-scenario harness validation

# Zero-Docker Executive Showcase (preflight check or full launch):
bun run showcase:check
bun run showcase
bun run showcase --strict                        # strict modality + portal session enforcement

# Run Inspect AI evaluation (--parallel-stacks >= 2 auto-launches isolated stacks on 3100+; --parallel-stacks 1 requires a pre-running :3000 stack):
../bin/gate test insurance-agency inspect-baseline --scenario 01,03,07,14,19,20 --difficulty natural --parallel-stacks 2
../bin/gate test insurance-agency inspect-summary eval/results/v0.9/realistic-natural --clean-logs eval/results/v0.9/clean-natural --include-anchors --json-out eval/results/v0.9/summary-report.json --export-replay-manifest eval/results/v0.9/replay-manifest.json

# Deterministic multi-turn DB-state suite (eval/deterministic/DT-01..DT-11):
bun eval/run-state-scenarios.ts --verify-reference
python3 eval/inspect/summarize_deterministic.py eval/results/deterministic-v1/logs --artifacts-dir eval/results/deterministic-v1/artifacts

# Build & start via Docker Compose (seeds DB on first start):
docker compose build
docker compose up                                # realistic (default, adversarial data)
SEED_MODE=clean docker compose up                # clean (no adversarial data)
```

**Pre-sweep pilot gate (required before any multi-model `inspect-baseline` sweep):** run 1 trial per workflow on natural prompts for every planned arm (`--epochs 1` per model and per `--learning-mechanism`), then check before the production run:
1. every requested scenario produced samples (no `dataset is empty`)
2. `stateDiff.findings` contain no correct actions flagged as collateral (escalations or audit tasks on the variant's trap clients)
3. receipt directories are unique per arm (`replay-manifest.json` has no duplicate `artifacts_dir`)
4. a 1-token call to each provider succeeds (Vertex Model Garden access; pass `--project` if Claude runs on a separate GCP project)
5. custom harnesses pass `scenario_id` on `POST /sim/reset` so multi-turn customer simulator rules on shared seed clients (`CLI-001/002/003/018`) do not fire in single-turn tasks

Fix everything the pilot surfaces in one pass, then run the production sweep once as-is. After any multi-batch sweep, verify every `.eval` header has `status == "success"` (`20/20` scenarios per arm) before writing `summary.md` and `replay-manifest.json`, because `run_baseline.py` skips `status == "error"` batches (e.g. transient Vertex MaaS `choices=None` responses) when printing its table.

**Sweep cost, archival, and cleanup:** state the expected cost before launching, using `summarize_inspect.py` rates (calibrated against the billing export; at list price about $0.48 per trial for `gemini-3.8-flash`, $0.22–$0.26 for `gemini-4-hydrogen` on 20-workflow sweeps [$0.15 on `DT`], $0.15 for `claude-sonnet-5-5`, $0.04 for `DeepSeek-V4.1-Flash`, and $0.013 for `gpt-oss-120b`; `gemini-3.8-flash` gets a 50% credit). Never leave paid Inspect `.eval` logs solely in `/tmp/`: persist every completed run into `eval/results/<run>/` (`.eval` logs, `summary.md`, `summary-report.json`, and `replay-manifest.json` in git) and sync its gitignored `artifacts/` bundles to `gs://btvaroska/insurance-agency/results/<run>/artifacts/` before wrapping up. Check actual spend afterwards with `bq` against the billing export (it lags 3 to 5 hours). After cancelling or finishing a sweep, kill its stacks before relaunching (with `BypassSandbox: true`: `pgrep -f "[r]un-showcase.ts --strict"` and `pgrep -f "[i]nsurance-agency/services/.*/src/index.ts"`), because the runner attaches to any stack already listening on `3100+`.

## 2. Documentation & Planning Workflow

| File | Purpose |
| :--- | :--- |
| [`README.md`](README.md) | Benchmark overview, framed as a first step in benchmarking agents on knowledge work: one worked task, 4-arm strict results table, what makes it hard, the 20 workflows, scoring, harness adapters, comparison, and limitations (`0` `—`/`→`/`->`; expand `P&C`, `E&O`, `AMS`, `CRM`, `ECM`, `MCP`, `CSR`, `FNOL`, `COI` on first use) |
| [`docs/README.md`](docs/README.md) | Docs index for everything outside the benchmark README, including the product narrative |
| [`design/story.md`](design/story.md) | Executive narrative, 11-person agency capacity model, and Three Lines of Defense |
| [`EXECUTIVE-BRIEF.md`](EXECUTIVE-BRIEF.md) | 2-page executive summary and KPI receipts |
| [`docs/executive-scorecard.html`](docs/executive-scorecard.html) | Self-contained GM3 Light Executive HTML Scorecard |
| [`.stitch/DESIGN.md`](.stitch/DESIGN.md) | Tier-2 Reusable Showcase GM3 Light token contract |
| [`CRITICAL.md`](CRITICAL.md) | Protected paths, OpenAPI contracts, seed determinism, and `EVAL-P01..P10` rubric invariants |
| [`DECISIONS.md`](DECISIONS.md) | Architectural Decision Records (`ADR-001`–`ADR-005`) |
| [`docs/roadmap.md`](docs/roadmap.md) | Strategic priorities by feature area & live roadmap |
| [`landscape.md`](landscape.md) | Insurance brokerage & agency market landscape |
| [`regulatory.md`](regulatory.md) | State & federal insurance regulatory compliance rules |
| [`docs/cujs.md`](docs/cujs.md) | Critical User Journeys |
| [`docs/specs.md`](docs/specs.md) | Product specs and requirements |
| [`docs/architecture.md`](docs/architecture.md) | System design and technical decisions |
| [`docs/testing.md`](docs/testing.md) | Test strategy and conventions |
| [`prompts/REGENERATE.md`](prompts/REGENERATE.md) | Single-service Phoenix regeneration blueprint (`services/claims` `:3007`) for Claude Code & Antigravity |
| `docs/features/*.md` | Completed work history per feature area |

Run `../bin/gate test insurance-agency` (or `./scripts/gate.sh`, or a targeted subtarget like `../bin/gate test insurance-agency claims`) before committing. Tests must pass before marking tasks complete.
