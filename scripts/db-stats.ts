/** Prints row counts and headline totals. Useful while a bulk load runs. */
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

function envLocal(key: string) {
  const f = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(f)) return undefined;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const url = process.env.DATABASE_URL || envLocal("DATABASE_URL");
  if (!url) throw new Error("DATABASE_URL missing");
  const pool = new Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });

  const tables = ["providers", "patients", "encounters", "charges", "claims", "claim_events", "ledger_entries", "denials", "appointments"];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const { rows } = await pool.query(`SELECT count(*)::bigint AS n FROM ${t}`);
    counts[t] = Number(rows[0].n);
  }
  const { rows: money } = await pool.query(`
    SELECT
      COALESCE(SUM(amount_cents) FILTER (WHERE type='charge'),0)::bigint AS charges,
      COALESCE(SUM(amount_cents) FILTER (WHERE type='insurance_payment'),0)::bigint AS ins,
      COALESCE(SUM(amount_cents) FILTER (WHERE type='patient_payment'),0)::bigint AS pat
    FROM ledger_entries`);
  const { rows: size } = await pool.query(`SELECT pg_size_pretty(pg_database_size(current_database())) AS size`);

  const usd = (c: string | number) => "$" + (Number(c) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(16)} ${n.toLocaleString()}`);
  console.log(`  ${"charges billed".padEnd(16)} ${usd(money[0].charges)}`);
  console.log(`  ${"insurance paid".padEnd(16)} ${usd(money[0].ins)}`);
  console.log(`  ${"patient paid".padEnd(16)} ${usd(money[0].pat)}`);
  console.log(`  ${"database size".padEnd(16)} ${size[0].size}`);

  // Days in A/R, the way the dashboard computes it.
  const { rows: ar } = await pool.query(`
    WITH b AS (
      SELECT c.id, SUM(CASE WHEN l.type='charge' THEN l.amount_cents
                            WHEN l.type IN ('insurance_payment','adjustment','write_off','transfer_to_patient') THEN -l.amount_cents
                            ELSE 0 END) AS bal
      FROM claims c JOIN ledger_entries l ON l.claim_id = c.id
      WHERE c.status NOT IN ('paid','closed') GROUP BY c.id)
    SELECT
      (SELECT COALESCE(SUM(bal),0) FROM b WHERE bal > 0) AS ins_ar,
      (SELECT COALESCE(SUM(amount_cents) FILTER (WHERE type='transfer_to_patient'),0)
            - COALESCE(SUM(amount_cents) FILTER (WHERE type='patient_payment'),0) FROM ledger_entries) AS pat_ar,
      (SELECT COALESCE(SUM(amount_cents),0)/90.0 FROM ledger_entries
       WHERE type='charge' AND posted_at >= now() - interval '90 days') AS per_day`);
  const insAr = Number(ar[0].ins_ar);
  const patAr = Math.max(Number(ar[0].pat_ar), 0);
  const perDay = Number(ar[0].per_day) || 1;
  console.log(`  ${"insurance A/R".padEnd(16)} ${usd(insAr)}`);
  console.log(`  ${"patient A/R".padEnd(16)} ${usd(patAr)}`);
  console.log(`  ${"DAYS IN A/R".padEnd(16)} ${((insAr + patAr) / perDay).toFixed(1)}`);
  console.log(`  ${"total rows".padEnd(16)} ${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString()}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
