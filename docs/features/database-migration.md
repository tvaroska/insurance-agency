# Database Migration (Sprint 2)

Drizzle/SQLite → Prisma for database independence. Prisma's single schema works across SQLite (local dev, Docker Compose) and PostgreSQL (k8s) with zero query changes.

---

## Completed Work

- **S2-DB-1** Prisma schema per service *(2026-05-13)*
  Created `prisma/schema.prisma` + `prisma.config.ts` (Prisma 7) for all 8 services. Added `prisma` + `@prisma/client` deps alongside existing Drizzle. All schemas validated.
  Plan: `.claude/plans/lazy-nibbling-turtle.md`

- **S2-DB-2** Replace Drizzle queries with Prisma Client *(2026-05-23)*
  Converted all 34 route/tool files across 8 services from Drizzle query builder to Prisma Client. Created `src/prisma.ts` singletons using `PrismaLibSql` adapter for Bun runtime. Added `applyPrismaCursorPagination` to shared pagination helper. Deleted `db.ts` from all services. Drizzle kept in devDependencies for test seeding (removed in S2-TEST-1). All 624 tests pass.
  Plan: `.claude/plans/reflective-floating-stallman.md`

- **S2-DB-3** Seed scripts for Prisma *(2026-05-24)*
  Rewrote all 8 service `seed.ts` from Drizzle ORM to Prisma Client. Table creation via `prisma.$executeRawUnsafe()` (DROP IF EXISTS + CREATE IF NOT EXISTS), data insertion via `createMany`/`create`. Registered as `prisma db seed` in each `prisma.config.ts`. Supports `SEED_MODE=clean|realistic` via env var. All 624 tests pass.
  Plan: `.claude/plans/validated-marinating-squirrel.md`
