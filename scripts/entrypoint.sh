#!/bin/sh
set -e

mkdir -p data

DB_FILE="data/${SERVICE_NAME}.db"
if [ ! -s "$DB_FILE" ]; then
  echo "Seeding ${SERVICE_NAME} (mode: ${SEED_MODE:-realistic})..."
  bun run src/seed.ts
fi

exec bun run src/index.ts
