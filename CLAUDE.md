# Evergreen Insurance Agency

## Services

Always use `docker compose` to start services. Never run services natively with `bun run`.

```bash
# Build images (once, or after code changes):
docker compose build

# Start services (seeds DB on first start):
docker compose up                                # realistic (default, adversarial data)
SEED_MODE=clean docker compose up                # clean (no adversarial data)

# Reset to seed state:
docker compose down && docker compose up

# Run tests (these run in-memory, no docker needed):
cd services/<name> && bun test
```

## Planning Workflow

| File | Purpose |
|------|---------|
| `TODO.md` | Sprint 0 (always active) + current sprint |
| `docs/roadmap.md` | Strategic priorities by feature area |
| `docs/cujs.md` | Critical User Journeys |
| `docs/specs.md` | Product specs and requirements |
| `docs/architecture.md` | System design and tech decisions |
| `docs/testing.md` | Test strategy and conventions |
| `docs/features/*.md` | Completed work history per feature area |

Commands: `/wopen` | `/wimplement {task-id}` | `/wnew-task` | `/wnew-feature` | `/wreplan` | `/wstatus`

Run `cd services/<name> && bun test` before committing. Tests must pass before marking tasks complete.
