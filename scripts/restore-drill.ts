/**
 * Automated restore drill (docs/08-restore-drill.md): restores the production
 * database as it was a little while ago into a temporary Neon branch, checks
 * the copy is complete and usable, reports how long that took, and deletes
 * the branch. Production itself is only read from (branching does not touch it).
 *
 *   NEON_API_KEY=... NEON_PROJECT_ID=... npx tsx --tsconfig tsconfig.scripts.json scripts/restore-drill.ts
 *
 * RESTORE_HOURS_AGO (default 1) picks the point in time; it must be inside
 * the project's history window (6 hours on Neon's Free plan, 1 day by default
 * on paid plans). The restored copy contains patient data: this script
 * prints counts only, and the branch is deleted even when a check fails.
 */
import pg from "pg";
import { MIGRATIONS } from "@/db/migrations";

const API = "https://console.neon.tech/api/v2";
const key = process.env.NEON_API_KEY?.trim();
const project = process.env.NEON_PROJECT_ID?.trim();
const hoursAgo = Number(process.env.RESTORE_HOURS_AGO ?? 1);
const gh = !!process.env.GITHUB_ACTIONS;

async function neon<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${key}`, Accept: "application/json", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`Neon API ${method} ${path}: HTTP ${res.status} ${text.slice(0, 300)}`);
  return JSON.parse(text) as T;
}

async function connectWithRetry(uri: string) {
  for (let i = 0; ; i++) {
    const c = new pg.Client({ connectionString: uri, ssl: { rejectUnauthorized: true }, connectionTimeoutMillis: 15_000 });
    try {
      await c.connect();
      return c;
    } catch (e) {
      await c.end().catch(() => undefined);
      if (i >= 11) throw e;
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

async function main() {
  if (!key || !project) {
    console.log("Restore drill skipped: set NEON_API_KEY and NEON_PROJECT_ID (repository secret and variable).");
    if (gh) console.log("::notice title=Restore drill::Skipped: NEON_API_KEY and NEON_PROJECT_ID are not set.");
    return;
  }
  const started = Date.now();
  const { branches } = await neon<{ branches: { id: string; name: string; default?: boolean }[] }>("GET", `/projects/${project}/branches`);
  const parent = branches.find((b) => b.default);
  if (!parent) throw new Error("No default branch found");
  const at = new Date(Date.now() - hoursAgo * 3_600_000);
  const created = await neon<{ branch: { id: string }; connection_uris?: { connection_uri: string }[] }>("POST", `/projects/${project}/branches`, {
    branch: { parent_id: parent.id, parent_timestamp: at.toISOString(), name: `restore-drill-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}` },
    endpoints: [{ type: "read_write" }],
  });
  const branchId = created.branch.id;
  const failures: string[] = [];
  const facts: string[] = [];
  try {
    const uri = created.connection_uris?.[0]?.connection_uri;
    if (!uri) throw new Error("Neon returned no connection string for the restored branch");
    const c = await connectWithRetry(uri);
    const restoredMs = Date.now() - started;
    const one = async (q: string) => (await c.query(q)).rows[0];
    const { rows: applied } = await c.query<{ name: string }>("SELECT name FROM _migrations");
    const names = new Set(applied.map((r) => r.name));
    const missing = MIGRATIONS.map((m) => m.name).filter((n) => !names.has(n));
    // Migrations newer than the restore point can be missing; a gap in the middle cannot.
    const lastApplied = MIGRATIONS.reduce((i, m, k) => (names.has(m.name) ? k : i), -1);
    const gaps = MIGRATIONS.slice(0, lastApplied + 1).filter((m) => !names.has(m.name)).map((m) => m.name);
    if (lastApplied < 0) failures.push("no migrations recorded in the restored copy");
    if (gaps.length) failures.push(`migrations missing from the middle: ${gaps.join(", ")}`);
    const counts = await one(`SELECT
      (SELECT count(*)::int FROM practices) AS practices, (SELECT count(*)::int FROM users) AS users,
      (SELECT count(*)::int FROM patients) AS patients, (SELECT count(*)::int FROM claims) AS claims,
      (SELECT count(*)::int FROM ledger_entries) AS ledger_entries, (SELECT count(*)::int FROM audit_log) AS audit_log`);
    if (!(counts.practices > 0 && counts.users > 0)) failures.push(`the copy has no practices or users: ${JSON.stringify(counts)}`);
    const guard = await one("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'ledger_entries_guard' AND NOT tgisinternal");
    if (guard.n !== 1) failures.push("the ledger guard trigger is missing from the restored copy");
    // The copy answers writes too (then they are discarded with the branch).
    await c.query("BEGIN; CREATE TEMP TABLE restore_drill_probe (x int); INSERT INTO restore_drill_probe VALUES (1); ROLLBACK;");
    await c.end();
    facts.push(`restored to ${at.toISOString()} and connected in ${(restoredMs / 1000).toFixed(0)} s`, `rows: ${JSON.stringify(counts)}`, `migrations: ${names.size} recorded${missing.length ? `, ${missing.length} newer than the restore point` : ""}`);
  } catch (e) {
    failures.push(e instanceof Error ? e.message : String(e));
  } finally {
    await neon("DELETE", `/projects/${project}/branches/${branchId}`).catch((e) => failures.push(`could not delete the drill branch ${branchId}; delete it by hand: ${e instanceof Error ? e.message : e}`));
  }
  console.log(facts.join("\n"));
  if (gh) {
    if (facts.length) console.log(`::notice title=Restore drill::${facts.join("; ")}`);
    for (const f of failures) console.log(`::error title=Restore drill::${f}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Restore drill\n\n${facts.map((f) => `- ${f}`).join("\n")}\n${failures.map((f) => `- **Failed:** ${f}`).join("\n")}\n`);
  }
  if (failures.length) {
    console.error(`Failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log(`Restore drill passed in ${((Date.now() - started) / 1000).toFixed(0)} s.`);
}

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
