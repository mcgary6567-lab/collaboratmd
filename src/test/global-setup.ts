import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { freshDb } from "./fresh-db";

declare module "vitest" {
  export interface ProvidedContext {
    /** Files holding a migrated database, and the same with the demo practice seeded (see testDb). */
    testDbSnapshots: { empty: string; seeded: string };
  }
}

/**
 * Builds the test database once per run: migrated, then seeded with the demo
 * practice, each saved as a snapshot. Every test file then loads a snapshot
 * (about 2 seconds) instead of migrating and seeding its own (about 20).
 * The snapshots are made at the start of each run, so the demo data's dates
 * are today's, as a fresh seed's would be.
 */
export default async function setup(project: TestProject) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "collaboratmd-test-db-"));
  const save = async (name: string, seed: boolean) => {
    const { client } = await freshDb({ seed });
    const file = path.join(dir, `${name}.tar.gz`);
    await writeFile(file, Buffer.from(await (await client.dumpDataDir("gzip")).arrayBuffer()));
    await client.close();
    return file;
  };
  const [empty, seeded] = await Promise.all([save("empty", false), save("seeded", true)]);
  project.provide("testDbSnapshots", { empty, seeded });
  return async () => {
    await rm(dir, { recursive: true, force: true });
  };
}
