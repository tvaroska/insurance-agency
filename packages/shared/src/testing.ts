import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { generateDevToken } from "./auth";
import type { CorrelationVariables, AuthVariables } from "./types";

export type AppVariables = CorrelationVariables & AuthVariables;

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
