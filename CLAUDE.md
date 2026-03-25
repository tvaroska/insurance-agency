# Evergreen Insurance Agency

## Services

Always use `docker compose` to start services. Never run services natively with `bun run`.

```bash
# Build images (once, or after code changes):
docker compose build                            # realistic seed (adversarial data, traps)
SEED_MODE=clean docker compose build             # clean seed (no adversarial data)

# Start services:
docker compose up                                # realistic
SEED_MODE=clean docker compose up                # clean

# Reset to seed state (DB baked into image):
docker compose down && docker compose up

# Run tests (these run in-memory, no docker needed):
cd services/<name> && bun test
```
