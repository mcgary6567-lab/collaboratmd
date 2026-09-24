import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import { MIGRATIONS } from "@/db/migrations";
import type { Db } from "@/db";

/**
 * A fresh in-memory Postgres per test file, migrated with the same bundled
 * migrations production runs and optionally seeded with the small demo
 * practice. Server modules take a `Db` argument, so they run against it
 * unchanged: these are integration tests of real SQL, not mocks.
 */
export async function testDb(opts: { seed?: boolean } = {}) {
  const client = new PGlite();
  await client.waitReady;
  for (const m of MIGRATIONS) await client.exec(m.sql);
  const db = drizzle({ client, schema }) as unknown as Db;
  if (opts.seed !== false) {
    const { seedDemoData } = await import("@/db/seed-data");
    const log = console.log;
    console.log = () => {};
    try {
      await seedDemoData(db);
    } finally {
      console.log = log;
    }
  }
  const [practice] = await db.select().from(schema.practices).limit(1);
  const [user] = await db.select().from(schema.users).limit(1);
  return {
    db,
    practiceId: practice?.id as string,
    userId: user?.id as string,
    close: () => client.close(),
  };
}
