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
  /** Runs `fn` inside one transaction on one connection (shared databases only). */
  transaction?: (fn: (tx: Pick<Runner, "db" | "exec">) => Promise<void>) => Promise<void>;
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
    const transaction: Runner["transaction"] = async (fn) => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await fn({ db: drizzlePg({ client, schema }), exec: async (sql) => void (await client.query(sql)) });
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
    };
    return { db: drizzlePg({ client: pool, schema }), exec: async (sql) => void (await pool.query(sql)), shared: true, transaction };
  }

  if (isServerless) {
    throw new Error(
      "DATABASE_URL is required in a serverless deployment. The embedded PGlite database writes to local disk, which serverless instances cannot persist or share. Set DATABASE_URL to a Postgres connection string.",
    );
  }

  // Embedded Postgres (WASM) for local development - no install required.
  const { PGlite } = await import("@electric-sql/pglite");
  // PGLITE_DIR lets end-to-end tests run against their own throwaway database.
  const dataDir = process.env.PGLITE_DIR?.trim() || path.join(process.cwd(), "data", "pg");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  return { db: drizzlePglite({ client, schema }), exec: async (sql) => void (await client.exec(sql)), shared: false };
}

async function migrate(runner: Pick<Runner, "db" | "exec">) {
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
async function seed(runner: Pick<Runner, "db" | "exec" | "shared">) {
  if (runner.shared && process.env.SEED_DEMO_DATA !== "true") return;
  const marker = await runner.db.execute<{ name: string }>("SELECT name FROM _migrations WHERE name = 'seed'");
  if (marker.rows.length > 0) return;
  await runner.exec(`TRUNCATE ${SEEDED_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  const { seedDemoData } = await import("./seed-data");
  await seedDemoData(runner.db);
  await runner.exec("INSERT INTO _migrations (name) VALUES ('seed')");
}

/**
 * Keeps development servers and preview deployments off the production
 * database. The production deployment marks its database when it starts;
 * anything else that connects to a marked database refuses to start, before a
 * migration or a test write can touch real data. Point DATABASE_URL at a
 * staging branch instead (docs/11-environments.md), or set
 * ALLOW_PRODUCTION_DATABASE=true for a deliberate one-off.
 */
export async function environmentGuard(runner: Pick<Runner, "db" | "exec" | "shared">, env: Record<string, string | undefined> = process.env) {
  if (!runner.shared) return;
  await runner.exec("CREATE TABLE IF NOT EXISTS _environment (label text PRIMARY KEY, set_at timestamptz NOT NULL DEFAULT now());");
  if (env.VERCEL_ENV === "production") {
    await runner.exec("INSERT INTO _environment (label) VALUES ('production') ON CONFLICT DO NOTHING");
    return;
  }
  const marked = await runner.db.execute<{ label: string }>("SELECT label FROM _environment WHERE label = 'production'");
  if (marked.rows.length && env.ALLOW_PRODUCTION_DATABASE !== "true") {
    const who = env.VERCEL_ENV === "preview" ? "This preview deployment" : "This development server";
    throw new Error(`${who} is connected to the production database. Point DATABASE_URL at a staging database (docs/11-environments.md), or set ALLOW_PRODUCTION_DATABASE=true if you mean to.`);
  }
}

/**
 * Migrations still to apply on a shared database, and whether the demo seed is
 * wanted but not loaded. Nothing pending (every start after a deploy has run
 * once) means no lock is taken at all.
 */
export async function pendingWork(runner: Pick<Runner, "db">, env: Record<string, string | undefined> = process.env) {
  const { rows: [t] } = await runner.db.execute<{ ok: boolean }>("SELECT to_regclass('_migrations') IS NOT NULL AS ok");
  const applied = t?.ok ? new Set((await runner.db.execute<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name)) : new Set<string>();
  return { migrations: MIGRATIONS.filter((m) => !applied.has(m.name)).map((m) => m.name), seed: env.SEED_DEMO_DATA === "true" && !applied.has("seed") };
}

/**
 * Runs migrations (and the demo seed, where asked for) on a shared database
 * with one instance at a time.
 *
 * Serverless platforms start many instances at once, and each one bootstraps
 * on its first request. Without a lock, concurrent cold starts would race to
 * apply the same migration or truncate a database another instance is seeding.
 *
 * The lock is transaction-scoped (pg_advisory_xact_lock) and the migrations run
 * inside that one transaction on one connection. Session-scoped locks are not
 * safe behind a transaction-mode pooler such as PgBouncer or Neon's pooler:
 * the lock and the unlock can land on different server connections, leaving
 * the lock held by a pooled connection forever and every later cold start
 * waiting on it. A transaction always stays on one server connection, and its
 * lock ends with it. (The key differs from the old session lock's, so a lock
 * left over from before cannot block this one.)
 */
const BOOTSTRAP_TX_LOCK_ID = 8_147_237; // arbitrary, must be stable across instances

/**
 * How long start-up may wait. Normally migrations run in the build
 * (scripts/migrate.ts) and a request never waits on them; these limits make a
 * start-up that is stuck anyway fail with an error in seconds, so the health
 * check answers 503 and alerts fire, instead of every request hanging.
 */
export const STARTUP_LIMITS = { lockWaitMs: 15_000, requestMs: 25_000 };

export async function prepare(runner: Runner, limits: { lockWaitMs: number } = STARTUP_LIMITS) {
  if (!runner.shared) {
    await migrate(runner);
    await seed(runner);
    return;
  }
  await environmentGuard(runner);
  const pending = await pendingWork(runner);
  if (!pending.migrations.length && !pending.seed) return;
  if (!runner.transaction) throw new Error("A shared database needs transactions to migrate");
  await runner.transaction(async (tx) => {
    // SET LOCAL lasts only for this transaction, so it is safe behind a pooler.
    await tx.exec(`SET LOCAL lock_timeout = '${Math.round(limits.lockWaitMs)}ms'`);
    await tx.exec(`SELECT pg_advisory_xact_lock(${BOOTSTRAP_TX_LOCK_ID})`);
    await tx.exec("SET LOCAL lock_timeout = 0");
    // Another instance may have done the work while this one waited; both steps check again.
    await migrate(tx);
    await seed({ ...tx, shared: true });
  });
}

/** Rejects if `p` has not settled within `ms`, naming what was slow. */
export function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 1000)} s`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function bootstrap(): Promise<Runner> {
  const runner = await connect();
  // Only a request waits on this limit; the build-time migration (scripts/migrate.ts) calls prepare() without it.
  await (runner.shared ? within(prepare(runner), STARTUP_LIMITS.requestMs, "Database start-up") : prepare(runner));
  return runner;
}

/** For scripts/migrate.ts: connect and run start-up work with no request-time limit. */
export async function migrateNow(lockWaitMs = 120_000) {
  const runner = await connect();
  await prepare(runner, { lockWaitMs });
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
