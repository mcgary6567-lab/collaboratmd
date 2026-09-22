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

  const usd = (c: string) => "$" + (Number(c) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(16)} ${n.toLocaleString()}`);
  console.log(`  ${"charges billed".padEnd(16)} ${usd(money[0].charges)}`);
  console.log(`  ${"insurance paid".padEnd(16)} ${usd(money[0].ins)}`);
  console.log(`  ${"patient paid".padEnd(16)} ${usd(money[0].pat)}`);
  console.log(`  ${"database size".padEnd(16)} ${size[0].size}`);
  console.log(`  ${"total rows".padEnd(16)} ${Object.values(counts).reduce((a, b) => a + b, 0).toLocaleString()}`);
  await pool.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
