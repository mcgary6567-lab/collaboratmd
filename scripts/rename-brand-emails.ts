/** One-off: move the demo account emails onto the CollaboratMD domain. */
import fs from "node:fs";
import { Pool } from "pg";

async function main() {
  const url =
    process.env.DATABASE_URL?.trim() ||
    fs.readFileSync(".env.local", "utf8").match(/DATABASE_URL\s*=\s*(.*)/)![1].trim().replace(/^["']|["']$/g, "");
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } });
  const before = await pool.query("SELECT email FROM users ORDER BY email");
  console.log("BEFORE:", before.rows.map((r) => r.email).join(", "));
  const res = await pool.query(
    "UPDATE users SET email = replace(email, '@medbill.local', '@collaboratmd.local') WHERE email LIKE '%@medbill.local'",
  );
  console.log("rows updated:", res.rowCount);
  const after = await pool.query("SELECT email, role FROM users ORDER BY email");
  console.log("AFTER: ", after.rows.map((r) => `${r.email} (${r.role})`).join(", "));
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
