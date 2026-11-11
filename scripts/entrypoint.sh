#!/bin/sh
set -e

SVC="${SERVICE_NAME:-$(basename "$(pwd)")}"

if [ -n "${DATABASE_URL:-}" ] && [ "${DATABASE_URL#file:}" != "${DATABASE_URL}" ]; then
  DB_FILE="${DATABASE_URL#file:}"
elif [ -n "${EVERGREEN_DATA_DIR:-}" ]; then
  DB_FILE="${EVERGREEN_DATA_DIR}/${SVC}.db"
else
  DB_FILE="data/${SVC}.db"
fi

mkdir -p "$(dirname "$DB_FILE")"

if [ ! -s "$DB_FILE" ]; then
  echo "Seeding ${SVC} (mode: ${SEED_MODE:-realistic}) into ${DB_FILE}..."
  bun run src/seed.ts
fi

exec bun run src/index.ts
