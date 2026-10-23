import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { PrismaLibSql } from "@prisma/adapter-libsql";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { generateDevToken } from "./auth";
import type { CorrelationVariables, AuthVariables } from "./types";

export type AppVariables = CorrelationVariables & AuthVariables;

/**
 * Resolves the database URL for testing, preferring TEST_DATABASE_URL if set.
 */
export function getTestDatabaseUrl(defaultDbPath: string): string {
  return process.env.TEST_DATABASE_URL ?? `file:${defaultDbPath}`;
}

/**
 * Creates an isolated Prisma Client backed by a temporary SQLite database
 * (or TEST_DATABASE_URL when set) alongside a bun:sqlite handle.
 */
export function createTestPrismaClient<T>(
  PrismaClientClass: new (opts: any) => T,
  defaultPrefix = "test-prisma-",
): {
  prisma: T;
  sqlite: Database;
  dbPath: string;
  url: string;
  cleanup: () => Promise<void>;
} {
  const tmpDir = mkdtempSync(join("/tmp", defaultPrefix));
  const defaultDbPath = join(tmpDir, "test.db");
  const url = getTestDatabaseUrl(defaultDbPath);
  const sqlitePath = url.startsWith("file:") ? url.slice("file:".length) : defaultDbPath;

  const sqlite = new Database(sqlitePath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  const adapter = new PrismaLibSql({ url });
  const prisma = new PrismaClientClass({ adapter });

  const cleanup = async () => {
    try {
      await (prisma as any)?.$disconnect?.();
    } catch {
      // ignore disconnect errors during test teardown
    }
    try {
      sqlite.close();
    } catch {
      // ignore close errors
    }
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore fs cleanup errors
    }
  };

  return { prisma, sqlite, dbPath: sqlitePath, url, cleanup };
}

/**
 * Creates an in-memory SQLite database with Drizzle ORM for testing.
 * Pass your service's schema module to get typed query access.
 */
export function createTestDatabase<T extends Record<string, unknown>>(schema: T) {
  const sqlite = new Database(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

/**
 * Generates an Authorization header with a JWT token containing the given scopes.
 * Uses the provided test secret (should match process.env.JWT_SECRET set in test setup).
 */
export async function authHeader(secret: string, scopes: string[]) {
  const token = await generateDevToken({ secret, scopes });
  return { Authorization: `Bearer ${token}` };
}
