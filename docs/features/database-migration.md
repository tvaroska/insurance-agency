# Database Migration (Sprint 2)

Drizzle/SQLite → Prisma for database independence. Prisma's single schema works across SQLite (local dev, Docker Compose) and PostgreSQL (k8s) with zero query changes.

---

## Completed Work

- **S2-DB-1** Prisma schema per service *(2026-05-13)*
  Created `prisma/schema.prisma` + `prisma.config.ts` (Prisma 7) for all 8 services. Added `prisma` + `@prisma/client` deps alongside existing Drizzle. All schemas validated.
  Plan: `.claude/plans/lazy-nibbling-turtle.md`
