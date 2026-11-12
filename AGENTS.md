# Evergreen Insurance Agency (`AGENTS.md`)

## 1. Services & Execution

Use `bun run showcase` for zero-Docker local execution of all 8 services (`:3000`–`:3007`) and the Executive Workbench (`http://localhost:3000/`), or `docker compose` for containerized execution:

```bash
# Canonical single-command runner (runs showcase:check, shared, 8 services in parallel, eval, contract, integration, and pytest):
proj-test insurance-agency

# Fast targeted subtargets (~0.5s–1.5s):
proj-test insurance-agency claims               # single service: ams|rater|crm|ecm|comm|carrier-summit|carrier-coastal|claims
proj-test insurance-agency eval                 # eval/__tests__/ + eval/*/__tests__/
proj-test insurance-agency integration          # tests/integration/*.test.ts
proj-test insurance-agency pytest               # eval/inspect/tests
proj-test insurance-agency showcase-check       # bun run showcase:check
proj-test insurance-agency validate-harness     # zero-daemon in-process 20-scenario harness validation

# Zero-Docker Executive Showcase (preflight check or full launch):
bun run showcase:check
bun run showcase
bun run showcase --strict                        # strict modality + portal session enforcement

# Run 3-model Inspect AI evaluation & regenerate README Results table:
proj-test insurance-agency inspect-baseline --scenario 01,03,07,14,19,20 --difficulty natural
proj-test insurance-agency inspect-summary eval/results/v0.7/realistic-natural --clean-logs eval/results/v0.7/clean-natural --include-anchors

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

Fix everything the pilot surfaces in one pass, then run the production sweep once as-is.

**Sweep cost and cleanup:** state the expected cost before launching, using `summarize_inspect.py` rates (calibrated against the billing export; at list price about $0.45 per trial for Gemini, $0.11 for Claude, $0.07 for DeepSeek; Gemini gets a 50% credit). Check actual spend afterwards with `bq` against the billing export (it lags 3 to 5 hours). After cancelling a sweep, kill its stacks before relaunching (with `BypassSandbox: true`: `pgrep -f "[r]un-showcase.ts --strict"` and `pgrep -f "[i]nsurance-agency/services/.*/src/index.ts"`), because the runner attaches to any stack already listening on `3100+`.

## 2. Documentation & Planning Workflow

| File | Purpose |
| :--- | :--- |
| [`README.md`](README.md) | Benchmark overview, framed as a first step in benchmarking agents on knowledge work: one worked task, 3-model strict results table, what makes it hard, the 20 workflows, scoring, harness adapters, comparison, and limitations (`0` `—`/`→`/`->`; expand `P&C`, `E&O`, `AMS`, `CRM`, `ECM`, `MCP`, `CSR`, `FNOL`, `COI` on first use) |
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

Run `proj-test insurance-agency` (or a targeted subtarget like `proj-test insurance-agency claims`) before committing. Tests must pass before marking tasks complete.
