import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { MIGRATIONS } from "@/db/migrations";
import type { Db } from "@/db";

/**
 * Migrates (and optionally seeds) a new in-memory database the slow way. The
 * global setup snapshots this once per run; tests load the snapshot (db.ts).
 */
export async function freshDb(opts: { seed: boolean }) {
  const client = new PGlite();
  await client.waitReady;
  // As hosted Postgres: dates computed in SQL are UTC days, whatever the machine's time zone.
  await client.exec("SET TIME ZONE 'UTC'");
  for (const m of MIGRATIONS) await client.exec(m.sql);
  const db = drizzle({ client, schema }) as unknown as Db;
  if (opts.seed) {
    const { seedDemoData } = await import("@/db/seed-data");
    const log = console.log;
    console.log = () => {};
    try {
      await seedDemoData(db);
    } finally {
      console.log = log;
    }
  }
  return { client, db };
}
