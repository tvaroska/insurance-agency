#!/usr/bin/env bash
set -euo pipefail

# Reset all service databases by running seed scripts in dependency order.
# Services with no cross-service dependencies run first.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "=== Resetting all service databases ==="

# Foundation services (no dependencies on other services)
for svc in ams rater crm claims; do
  echo "  Seeding $svc..."
  (cd "$ROOT_DIR/services/$svc" && bun run seed)
done

# Services that depend on foundation services
for svc in ecm comm carrier-summit carrier-coastal; do
  echo "  Seeding $svc..."
  (cd "$ROOT_DIR/services/$svc" && bun run seed)
done

echo "=== All databases reset ==="
