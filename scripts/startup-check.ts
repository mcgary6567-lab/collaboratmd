/**
 * CI check of start-up against a real Postgres behind PgBouncer in
 * transaction mode (the way Neon's pooler works), which the embedded test
 * database cannot show. It starts several migrations at once, like cold
 * starts after a deploy, and then checks that:
 *
 * - every one finished, and only one of them loaded the demo data;
 * - no advisory lock is left held by a pooled connection (the 2026-09-27
 *   outage: a session lock taken and released on different server
 *   connections, so every later start waited forever);
 * - starting again with nothing pending is quick.
 *
 *   DATABASE_URL=<pooled> DIRECT_DATABASE_URL=<direct> npx tsx --tsconfig tsconfig.scripts.json scripts/startup-check.ts
 */
import { spawn } from "node:child_process";
import pg from "pg";

const pooled = process.env.DATABASE_URL;
const direct = process.env.DIRECT_DATABASE_URL;
if (!pooled || !direct) throw new Error("Set DATABASE_URL (through the pooler) and DIRECT_DATABASE_URL");

function migrateOnce(): Promise<{ code: number | null; ms: number; out: string }> {
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--tsconfig", "tsconfig.scripts.json", "scripts/migrate.ts"], { env: { ...process.env, SEED_DEMO_DATA: "true" } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => resolve({ code, ms: Date.now() - started, out }));
  });
}

/**
 * On GitHub Actions, the failure also as an annotation: annotations of a public
 * repository can be read without signing in, unlike the job's log. Only the
 * error text is included (no connection strings: they are masked secrets-free
 * local URLs here, and are stripped anyway).
 */
function annotate(text: string) {
  if (!process.env.GITHUB_ACTIONS) return;
  const clean = text.replace(/postgres(ql)?:\/\/\S+/g, "<database url>").slice(0, 3000);
  console.log(`::error title=Start-up check failed::${clean.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")}`);
}

async function main() {
  const failures: string[] = [];
  const runs = await Promise.all(Array.from({ length: 4 }, migrateOnce));
  runs.forEach((r, i) => {
    console.log(`start ${i + 1}: exit ${r.code} in ${(r.ms / 1000).toFixed(1)} s`);
    if (r.code !== 0) failures.push(`start ${i + 1} failed:\n${r.out}`);
  });

  const c = new pg.Client({ connectionString: direct });
  await c.connect();
  const { rows: locks } = await c.query("SELECT pid, objid FROM pg_locks WHERE locktype = 'advisory'");
  if (locks.length) failures.push(`advisory locks still held: ${JSON.stringify(locks)}`);
  const { rows: [counts] } = await c.query("SELECT (SELECT count(*)::int FROM practices) AS practices, (SELECT count(*)::int FROM _migrations WHERE name = 'seed') AS seeded");
  if (counts.practices !== 1 || counts.seeded !== 1) failures.push(`demo data loaded more or less than once: ${JSON.stringify(counts)}`);
  await c.end();

  const again = await migrateOnce();
  console.log(`start with nothing pending: exit ${again.code} in ${(again.ms / 1000).toFixed(1)} s`);
  if (again.code !== 0) failures.push(`second start failed:\n${again.out}`);
  if (again.ms > 15_000) failures.push(`a start with nothing to do took ${again.ms} ms`);

  // A start-up that cannot get the lock gives up with an error in seconds instead of waiting forever.
  const holder = new pg.Client({ connectionString: direct });
  await holder.connect();
  const { MIGRATIONS } = await import("@/db/migrations");
  const last = MIGRATIONS[MIGRATIONS.length - 1].name;
  await holder.query("DELETE FROM _migrations WHERE name = $1", [last]);
  await holder.query("SELECT pg_advisory_lock(8147237)");
  const { migrateNow } = await import("@/db");
  const t0 = Date.now();
  const stuck = await migrateNow(2_000).then(() => null, (e: Error) => e);
  console.log(`start while the lock is held: ${stuck ? `failed after ${((Date.now() - t0) / 1000).toFixed(1)} s (${stuck.message})` : "did not fail"}`);
  if (!stuck || !/lock timeout/i.test(stuck.message) || Date.now() - t0 > 10_000) failures.push(`a blocked start-up should fail fast with a lock timeout, got: ${stuck?.message ?? "success"}`);
  await holder.query("SELECT pg_advisory_unlock(8147237)");
  await holder.end();
  const recovered = await migrateOnce();
  console.log(`start after the lock is released: exit ${recovered.code}`);
  if (recovered.code !== 0) failures.push(`start after release failed:\n${recovered.out}`);

  if (failures.length) {
    console.error(failures.join("\n\n"));
    annotate(failures.join("\n\n"));
    process.exit(1);
  }
  console.log("Start-up behind the pooler: OK");
}

main().catch((e) => {
  console.error(e);
  annotate(e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e));
  process.exit(1);
});
