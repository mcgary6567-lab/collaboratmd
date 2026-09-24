import "server-only";
import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { MIGRATIONS } from "./migrations";
import { needsSsl, poolSize } from "./connection";

export type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

type Runner = {
  db: Db;
  /** Executes a multi-statement SQL script (migrations). */
  exec: (sql: string) => Promise<void>;
  /** True for a real Postgres server, false for the embedded dev database. */
  shared: boolean;
};

const globalRef = globalThis as unknown as { __collaboratmdDb?: Promise<Runner> };

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

async function connect(): Promise<Runner> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: url,
      // Serverless invocations are short-lived and highly concurrent; a large
      // pool per instance exhausts the server's connection limit. Use a pooled
      // connection string (PgBouncer, Neon/Supabase pooler) in that setting.
      max: poolSize(isServerless),
      idleTimeoutMillis: isServerless ? 10_000 : 30_000,
      connectionTimeoutMillis: 15_000,
      // Managed providers (Neon, Supabase) present publicly trusted
      // certificates, so verify them: encryption without verification does
      // not stop an impostor server. DATABASE_SSL_NO_VERIFY=1 is for a
      // self-hosted server with a private CA. A local server usually speaks
      // plaintext, so do not force TLS there.
      ssl: needsSsl(url) ? { rejectUnauthorized: process.env.DATABASE_SSL_NO_VERIFY !== "1" } : false,
    });
    // Serverless Postgres (Neon, Supabase) suspends idle compute, which
    // terminates pooled connections. node-postgres surfaces that as an
    // 'error' event on the pool, and an unhandled 'error' event takes the
    // process down. The pool discards the dead client and the next query
    // opens a fresh one, so logging is the correct response.
    pool.on("error", (err) => {
      console.error(`[collaboratmd] idle Postgres client error: ${err.message}`);
    });
    return { db: drizzlePg({ client: pool, schema }), exec: async (sql) => void (await pool.query(sql)), shared: true };
  }

  if (isServerless) {
    throw new Error(
      "DATABASE_URL is required in a serverless deployment. The embedded PGlite database writes to local disk, which serverless instances cannot persist or share. Set DATABASE_URL to a Postgres connection string.",
    );
  }

  // Embedded Postgres (WASM) for local development - no install required.
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = path.join(process.cwd(), "data", "pg");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  return { db: drizzlePglite({ client, schema }), exec: async (sql) => void (await client.exec(sql)), shared: false };
}

async function migrate(runner: Runner) {
  await runner.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());",
  );
  const applied = new Set(
    (await runner.db.execute<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name),
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.name)) continue;
    await runner.exec(migration.sql);
    await runner.exec(`INSERT INTO _migrations (name) VALUES ('${migration.name.replace(/'/g, "''")}')`);
  }
}

/** Tables the demo seed owns, ordered so truncation respects foreign keys. */
const SEEDED_TABLES = [
  "audit_log",
  "denials",
  "ledger_entries",
  "remittances",
  "claim_events",
  "claims",
  "charges",
  "encounters",
  "appointments",
  "eligibility_checks",
  "patient_insurances",
  "patients",
  "payers",
  "providers",
  "users",
  "practices",
  "cpt_codes",
  "icd10_codes",
];

/**
 * Loads demo data exactly once, tracked by a marker row.
 *
 * The seed writes across many tables without a wrapping transaction, so a
 * failure partway would otherwise leave a half-populated database that the
 * next boot mistakes for a finished seed. Clearing the seeded tables before
 * each attempt makes a failed seed self-healing on restart.
 *
 * It runs automatically on the embedded dev database. Against a real Postgres
 * it requires SEED_DEMO_DATA=true, because it deletes existing rows.
 */
async function seed(runner: Runner) {
  if (runner.shared && process.env.SEED_DEMO_DATA !== "true") return;
  const marker = await runner.db.execute<{ name: string }>("SELECT name FROM _migrations WHERE name = 'seed'");
  if (marker.rows.length > 0) return;
  await runner.exec(`TRUNCATE ${SEEDED_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  const { seedDemoData } = await import("./seed-data");
  await seedDemoData(runner.db);
  await runner.exec("INSERT INTO _migrations (name) VALUES ('seed')");
}

/**
 * Runs migrations and seeding under a Postgres advisory lock.
 *
 * Serverless platforms start many instances at once, and each one bootstraps
 * on its first request. Without the lock, concurrent cold starts would race to
 * apply the same migration or truncate a database another instance is seeding.
 * The lock is session-scoped and released automatically if a connection drops.
 */
const BOOTSTRAP_LOCK_ID = 8_147_236; // arbitrary, must be stable across instances

async function prepare(runner: Runner) {
  if (!runner.shared) {
    await migrate(runner);
    await seed(runner);
    return;
  }
  await runner.exec(`SELECT pg_advisory_lock(${BOOTSTRAP_LOCK_ID})`);
  try {
    await migrate(runner);
    await seed(runner);
  } finally {
    await runner.exec(`SELECT pg_advisory_unlock(${BOOTSTRAP_LOCK_ID})`);
  }
}

async function bootstrap(): Promise<Runner> {
  const runner = await connect();
  await prepare(runner);
  return runner;
}

/** Singleton database handle (survives Next.js HMR and warm instances). */
export async function getDb(): Promise<Db> {
  if (!globalRef.__collaboratmdDb) {
    globalRef.__collaboratmdDb = bootstrap().catch((err) => {
      globalRef.__collaboratmdDb = undefined;
      throw err;
    });
  }
  return (await globalRef.__collaboratmdDb).db;
}

export { schema };
