# Evergreen Insurance Agency (`AGENTS.md`)

## 1. Services & Execution

Use `bun run showcase` for zero-Docker local execution of all 8 services (`:3000`–`:3007`) and the Executive Workbench (`http://localhost:3000/`), or `docker compose` for containerized execution:

```bash
# Zero-Docker Executive Showcase (preflight check or full launch):
bun run showcase:check
bun run showcase

# Build & start via Docker Compose (seeds DB on first start):
docker compose build
docker compose up                                # realistic (default, adversarial data)
SEED_MODE=clean docker compose up                # clean (no adversarial data)

# Reset to seed state:
docker compose down && docker compose up

# Run tests (in-memory, no docker needed):
cd services/<name> && bun test
bun test eval/__tests__/
```

## 2. Documentation & Planning Workflow

| File | Purpose |
| :--- | :--- |
| [`README.md`](README.md) | Executive showcase overview, Seven Promises (`I1`–`I7`), 5 Hero Journeys, and 20-scenario benchmark suite |
| [`design/story.md`](design/story.md) | Executive narrative, 11-person agency capacity model, and Three Lines of Defense |
| [`EXECUTIVE-BRIEF.md`](EXECUTIVE-BRIEF.md) | 2-page executive summary and KPI receipts |
| [`docs/executive-scorecard.html`](docs/executive-scorecard.html) | Self-contained GM3 Light Executive HTML Scorecard |
| [`.stitch/DESIGN.md`](.stitch/DESIGN.md) | Tier-2 Reusable Showcase GM3 Light token contract |
| [`CRITICAL.md`](CRITICAL.md) | Protected paths, OpenAPI contracts, seed determinism, and `EVAL-P01..P10` rubric invariants |
| [`DECISIONS.md`](DECISIONS.md) | Architectural Decision Records (`ADR-001`–`ADR-004`) |
| [`docs/roadmap.md`](docs/roadmap.md) | Strategic priorities by feature area & live roadmap |
| [`landscape.md`](landscape.md) | Insurance brokerage & agency market landscape |
| [`regulatory.md`](regulatory.md) | State & federal insurance regulatory compliance rules |
| [`docs/cujs.md`](docs/cujs.md) | Critical User Journeys |
| [`docs/specs.md`](docs/specs.md) | Product specs and requirements |
| [`docs/architecture.md`](docs/architecture.md) | System design and technical decisions |
| [`docs/testing.md`](docs/testing.md) | Test strategy and conventions |
| `docs/features/*.md` | Completed work history per feature area |

Run `cd services/<name> && bun test` (or `proj-test insurance-agency`) before committing. Tests must pass before marking tasks complete.
