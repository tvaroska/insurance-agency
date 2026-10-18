# Production Readiness

Sprint 0 archive: critical bugs, security fixes, infrastructure improvements.

---

## Completed Work

No completed work yet.

## In Progress

No work in progress.

## Planned Work

### PostgreSQL Migration (Priority: P2)
- **Problem:** SQLite-per-service blocks concurrent agent evaluation (write locks) and prevents realistic transaction semantics. Multi-agent research requires shared-state databases with proper concurrency control.
- **Scope:** See `docs/features/evaluation-system.md` for full scope. Primary entry: migrate AMS first, then Claims, then remaining services. Adds PostgreSQL container to Docker Compose, replaces baked-in SQLite with SQL migrations, adds connection pooling.
- **Priority:** P2
- **Status:** Planned
- **Added:** 2026-03-31
