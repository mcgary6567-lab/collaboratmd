/** Verifies no open denial has a lapsed appeal deadline. */
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
  const { rows } = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status IN ('open','in_progress','appealed'))::int AS open_total,
      COUNT(*) FILTER (WHERE status IN ('open','in_progress','appealed')
                         AND appeal_deadline < now()::date)::int AS overdue,
      COALESCE(MAX(now()::date - appeal_deadline) FILTER (
        WHERE status IN ('open','in_progress','appealed')), 0)::int AS worst_days_past,
      COALESCE(MIN(appeal_deadline - now()::date) FILTER (
        WHERE status IN ('open','in_progress','appealed')), 0)::int AS soonest_days_left
    FROM denials`);
  const r = rows[0];
  console.log(`  open denials        ${r.open_total}`);
  console.log(`  overdue appeals     ${r.overdue}`);
  console.log(`  worst days past due ${r.worst_days_past}`);
  console.log(`  soonest due in      ${r.soonest_days_left} days`);
  console.log(r.overdue === 0 ? "  PASS: no appeal window has lapsed" : "  FAIL: lapsed appeal windows remain");
  await pool.end();
  process.exit(r.overdue === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
