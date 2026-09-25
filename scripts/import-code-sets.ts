/**
 * Loads a CMS code-set file into the database, for files too large to upload.
 *
 *   npm run import:code-sets -- <ncci_ptp|ncci_mue|coverage> <file> "<label>"
 *
 * Uses DATABASE_URL (or .env.local). The file is the tab- or comma-separated
 * table from CMS (see Settings, Code sets for where each comes from).
 */
import fs from "node:fs";

if (!process.env.DATABASE_URL && fs.existsSync(".env.local")) {
  const m = fs.readFileSync(".env.local", "utf8").match(/DATABASE_URL\s*=\s*(.*)/);
  if (m) process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, "");
}

async function main() {
  const [set, file, label] = process.argv.slice(2);
  if (!["ncci_ptp", "ncci_mue", "coverage"].includes(set ?? "") || !file) {
    console.error('Usage: npm run import:code-sets -- <ncci_ptp|ncci_mue|coverage> <file> "<label>"');
    process.exit(2);
  }
  const { getDb } = await import("@/db");
  const { importCodeSet } = await import("@/server/code-sets");
  const text = fs.readFileSync(file, "latin1");
  const started = Date.now();
  const r = await importCodeSet(await getDb(), set as "ncci_ptp", text, label || file, `cli:${process.env.USER ?? process.env.USERNAME ?? "operator"}`);
  console.log(`Loaded ${r.added} rows (${r.skipped} skipped) in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
