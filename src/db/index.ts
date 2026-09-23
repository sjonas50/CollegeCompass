import { mkdirSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { migrate as migratePostgres } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { env } from "@/env";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

type Handle = { db: Db; migrate: () => Promise<void> };

function connect(): Handle {
  const { DATABASE_URL, PGLITE_DATA_DIR } = env();
  if (DATABASE_URL) {
    const client = postgres(DATABASE_URL, { max: 5 });
    const db = drizzlePostgres({ client, schema });
    return { db, migrate: () => migratePostgres(db, { migrationsFolder: MIGRATIONS_FOLDER }) };
  }
  mkdirSync(PGLITE_DATA_DIR, { recursive: true });
  const db = drizzlePglite({ client: new PGlite(PGLITE_DATA_DIR), schema });
  return { db, migrate: () => migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER }) };
}

// Survives dev-server hot reloads so we don't open a new pool (or PGlite instance) per edit.
const globalForDb = globalThis as unknown as { __ccDb?: Handle; __ccDbReady?: Promise<void> };

/**
 * The app database. Local development without DATABASE_URL uses an embedded PGlite database
 * and applies migrations automatically; production applies migrations in the deploy step.
 */
export async function getDb(): Promise<Db> {
  globalForDb.__ccDb ??= connect();
  if (!env().DATABASE_URL) {
    globalForDb.__ccDbReady ??= globalForDb.__ccDb.migrate();
    await globalForDb.__ccDbReady;
  }
  return globalForDb.__ccDb.db;
}

/** Apply migrations to the configured database (used by `npm run db:migrate`). */
export async function migrateDb() {
  globalForDb.__ccDb ??= connect();
  await globalForDb.__ccDb.migrate();
}

/** A fresh in-memory database with all migrations applied. For tests. */
export async function createTestDb(): Promise<Db> {
  const db = drizzlePglite({ client: new PGlite(), schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

export { schema };
