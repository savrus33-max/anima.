/**
 * Database client — lazy-initialised so the module can be imported during
 * Next.js build without DATABASE_URL being present in the build environment.
 * The connection is only created on the first actual database call at runtime.
 */
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

type DbGlobal = typeof globalThis & {
  __animaPool?: Pool;
  __animaDb?: NodePgDatabase;
};

function getPool(): Pool {
  const g = globalThis as DbGlobal;

  if (!g.__animaPool) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL environment variable is not set. " +
          "Please add it to your .env file or deployment config."
      );
    }

    g.__animaPool = new Pool({
      connectionString: url,
      // Keep a small pool so serverless/dev builds don't exhaust PG connections.
      max: process.env.NODE_ENV === "production" ? 10 : 3,
    });
  }

  return g.__animaPool;
}

function getDb(): NodePgDatabase {
  const g = globalThis as DbGlobal;
  if (!g.__animaDb) {
    g.__animaDb = drizzle(getPool());
  }
  return g.__animaDb;
}

// Export a Proxy so callers can do `import { db } from "@/db"` and have it
// always resolve to the lazily-created client without wrapping every call.
export const db = new Proxy({} as NodePgDatabase, {
  get(_target, prop) {
    const client = getDb();
    const value = (client as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(client) : value;
  },
});

// Also export the pool for direct use (e.g. health checks).
export const pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const p = getPool();
    const value = (p as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(p) : value;
  },
});
