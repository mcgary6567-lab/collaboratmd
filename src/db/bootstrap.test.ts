import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDb } from "@/test/db";
import { MIGRATIONS } from "./migrations";
import { pendingWork } from "./index";

describe("start-up work on a shared database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => {
    t = await testDb({ seed: false });
    // The test database applies migrations directly; record them the way start-up does.
    expect(await pendingWork({ db: t.db }, {})).toEqual({ migrations: MIGRATIONS.map((m) => m.name), seed: false });
    await t.db.execute("CREATE TABLE _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
    for (const m of MIGRATIONS) await t.db.execute(`INSERT INTO _migrations (name) VALUES ('${m.name}')`);
  });
  afterAll(async () => { await t?.close(); });

  it("finds nothing to do once every migration is applied, so no lock is taken", async () => {
    expect(await pendingWork({ db: t.db }, {})).toEqual({ migrations: [], seed: false });
  });

  it("lists a migration that has not run, and a wanted seed that has not loaded", async () => {
    const last = MIGRATIONS[MIGRATIONS.length - 1].name;
    await t.db.execute(`DELETE FROM _migrations WHERE name = '${last}'`);
    expect(await pendingWork({ db: t.db }, { SEED_DEMO_DATA: "true" })).toEqual({ migrations: [last], seed: true });
    await t.db.execute(`INSERT INTO _migrations (name) VALUES ('${last}')`);
  });
});
