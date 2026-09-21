import "server-only";
import fs from "node:fs";
import path from "node:path";
import { drizzle as drizzlePglite, type PgliteDatabase } from "drizzle-orm/pglite";
import { drizzle as drizzlePg, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export type Db = PgliteDatabase<typeof schema> | NodePgDatabase<typeof schema>;

type Runner = {
  db: Db;
  /** Executes a multi-statement SQL script (migrations). */
  exec: (sql: string) => Promise<void>;
};

const globalRef = globalThis as unknown as { __medbillDb?: Promise<Runner> };

async function connect(): Promise<Runner> {
  const url = process.env.DATABASE_URL?.trim();
  if (url) {
    const { Pool } = await import("pg");
    const pool = new Pool({ connectionString: url });
    const db = drizzlePg({ client: pool, schema });
    return { db, exec: async (sql) => void (await pool.query(sql)) };
  }
  // Embedded Postgres (WASM) for local development - no install required.
  const { PGlite } = await import("@electric-sql/pglite");
  const dataDir = path.join(process.cwd(), "data", "pg");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  const db = drizzlePglite({ client, schema });
  return { db, exec: async (sql) => void (await client.exec(sql)) };
}

async function migrate(runner: Runner) {
  await runner.exec(
    "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());",
  );
  const dir = path.join(process.cwd(), "src", "db", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied = new Set(
    (await runner.db.execute<{ name: string }>("SELECT name FROM _migrations")).rows.map((r) => r.name),
  );
  for (const file of files) {
    if (applied.has(file)) continue;
    const sqlText = fs.readFileSync(path.join(dir, file), "utf8");
    await runner.exec(sqlText);
    await runner.exec(`INSERT INTO _migrations (name) VALUES ('${file.replace(/'/g, "''")}')`);
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
 * Seeds demo data exactly once, tracked by a marker row.
 *
 * The seed writes across many tables without a wrapping transaction, so a
 * failure partway would otherwise leave a half-populated database that the
 * next boot mistakes for a finished seed. Clearing the seeded tables before
 * each attempt makes a failed seed self-healing on restart.
 */
async function seed(runner: Runner) {
  const marker = await runner.db.execute<{ name: string }>("SELECT name FROM _migrations WHERE name = 'seed'");
  if (marker.rows.length > 0) return;
  await runner.exec(`TRUNCATE ${SEEDED_TABLES.join(", ")} RESTART IDENTITY CASCADE`);
  const { seedDemoData } = await import("./seed-data");
  await seedDemoData(runner.db);
  await runner.exec("INSERT INTO _migrations (name) VALUES ('seed')");
}

async function bootstrap(): Promise<Runner> {
  const runner = await connect();
  await migrate(runner);
  await seed(runner);
  return runner;
}

/** Singleton database handle (survives Next.js HMR via globalThis). */
export async function getDb(): Promise<Db> {
  if (!globalRef.__medbillDb) {
    globalRef.__medbillDb = bootstrap().catch((err) => {
      globalRef.__medbillDb = undefined;
      throw err;
    });
  }
  return (await globalRef.__medbillDb).db;
}

export { schema };
