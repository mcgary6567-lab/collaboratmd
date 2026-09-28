import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { inject, vi } from "vitest";
import * as schema from "@/db/schema";
import type { Db } from "@/db";
import { freshDb } from "./fresh-db";

/**
 * A fresh in-memory Postgres per test file, migrated with the same bundled
 * migrations production runs and optionally seeded with the small demo
 * practice. Server modules take a `Db` argument, so they run against it
 * unchanged: these are integration tests of real SQL, not mocks.
 *
 * It is loaded from the snapshot the global setup made at the start of the
 * run (src/test/global-setup.ts). A test that has faked the clock gets its
 * own seed instead, since the demo data's dates follow the clock.
 */
export async function testDb(opts: { seed?: boolean } = {}) {
  const seed = opts.seed !== false;
  const snapshots = inject("testDbSnapshots");
  let client: PGlite;
  let db: Db;
  if (snapshots && !vi.isFakeTimers()) {
    const data = await readFile(seed ? snapshots.seeded : snapshots.empty);
    client = new PGlite({ loadDataDir: new Blob([data]) });
    await client.waitReady;
    db = drizzle({ client, schema }) as unknown as Db;
  } else {
    ({ client, db } = await freshDb({ seed }));
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
