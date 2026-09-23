/** One-off: move claim control numbers from the MB prefix onto CMD. */
import fs from "node:fs";
import { Pool } from "pg";

async function main() {
  const url =
    process.env.DATABASE_URL?.trim() ||
    fs.readFileSync(".env.local", "utf8").match(/DATABASE_URL\s*=\s*(.*)/)![1].trim().replace(/^["']|["']$/g, "");
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const b = await pool.query("SELECT count(*)::int AS n FROM claims WHERE control_number LIKE 'MB%'");
  console.log("claims with MB prefix:", b.rows[0].n);
  const res = await pool.query(
    "UPDATE claims SET control_number = 'CMD' || substr(control_number, 3) WHERE control_number LIKE 'MB%'",
  );
  console.log("rows updated:", res.rowCount);
  const a = await pool.query(
    "SELECT count(*)::int AS mb FROM claims WHERE control_number LIKE 'MB%'",
  );
  const c = await pool.query(
    "SELECT count(*)::int AS cmd, count(DISTINCT control_number)::int AS uniq FROM claims WHERE control_number LIKE 'CMD%'",
  );
  console.log("left on MB:", a.rows[0].mb, "| CMD rows:", c.rows[0].cmd, "| distinct:", c.rows[0].uniq);
  const s = await pool.query("SELECT control_number FROM claims ORDER BY control_number LIMIT 3");
  console.log("sample:", s.rows.map((r) => r.control_number).join(", "));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
