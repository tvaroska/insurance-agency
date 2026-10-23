# Evergreen Insurance Agency (`~/projects/insurance-agency`)

This file mirrors [`CLAUDE.md`](CLAUDE.md) for agent progressive-disclosure navigation.

## 1. Services & Execution

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

## 2. Documentation & Planning Index

| File | Purpose |
| :--- | :--- |
| [`CLAUDE.md`](CLAUDE.md) | Core service & workflow rules |
| [`README.md`](README.md) | System overview, service ports, and domain model |
| [`TODO.md`](TODO.md) | Sprint 0 (always active) + current sprint tasks |
| [`landscape.md`](landscape.md) | Insurance brokerage & agency market landscape |
| [`regulatory.md`](regulatory.md) | State & federal insurance regulatory compliance rules |
| `docs/roadmap.md` | Strategic priorities by feature area |
| `docs/cujs.md` | Critical User Journeys |
| `docs/specs.md` | Product specs and requirements |
| `docs/architecture.md` | System design and technical decisions |
| `docs/testing.md` | Test strategy and conventions |
