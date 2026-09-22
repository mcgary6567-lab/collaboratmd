/** Breaks down the net collection rate and what is suppressing it. */
import fs from "node:fs";
import path from "node:path";
import { Pool } from "pg";

function envLocal(key: string) {
  const f = path.join(process.cwd(), ".env.local");
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
}

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || envLocal("DATABASE_URL"),
    ssl: { rejectUnauthorized: false },
  });
  const usd = (c: unknown) => "$" + (Number(c) / 100).toLocaleString("en-US", { maximumFractionDigits: 0 });

  const { rows } = await pool.query(`
    SELECT
      COALESCE(SUM(amount_cents) FILTER (WHERE type='charge'),0) AS charges,
      COALESCE(SUM(amount_cents) FILTER (WHERE type='adjustment'),0) AS contractual,
      COALESCE(SUM(amount_cents) FILTER (WHERE type='write_off'),0) AS write_offs,
      COALESCE(SUM(amount_cents) FILTER (WHERE type IN ('insurance_payment','patient_payment')),0) AS payments
    FROM ledger_entries WHERE posted_at >= now() - interval '12 months'`);
  const r = rows[0];
  const denom = Number(r.charges) - Number(r.contractual);
  const ncr = denom > 0 ? Number(r.payments) / denom : 0;

  const { rows: wo } = await pool.query(`
    SELECT note, COUNT(*)::int AS n, SUM(amount_cents) AS amount
    FROM ledger_entries
    WHERE type='write_off' AND posted_at >= now() - interval '12 months'
    GROUP BY note ORDER BY amount DESC LIMIT 6`);

  const { rows: den } = await pool.query(`
    SELECT status, COUNT(*)::int AS n FROM denials GROUP BY status ORDER BY n DESC`);

  console.log(`  charges                 ${usd(r.charges)}`);
  console.log(`  contractual adjustments ${usd(r.contractual)}`);
  console.log(`  write-offs              ${usd(r.write_offs)}`);
  console.log(`  payments                ${usd(r.payments)}`);
  console.log(`  NET COLLECTION RATE     ${(ncr * 100).toFixed(1)}%`);
  console.log(`  write-off drag          ${((Number(r.write_offs) / denom) * 100).toFixed(1)} points`);
  console.log("  write-offs by reason:");
  for (const w of wo) console.log(`    ${String(w.note).slice(0, 44).padEnd(46)} ${String(w.n).padStart(6)}  ${usd(w.amount)}`);
  console.log("  denial outcomes:");
  for (const d of den) console.log(`    ${String(d.status).padEnd(14)} ${d.n}`);
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
