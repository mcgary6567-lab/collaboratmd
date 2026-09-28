/**
 * Loads a CMS code-set file into the database, for files too large to upload.
 *
 *   npm run import:code-sets -- <ncci_ptp|ncci_mue|coverage|hcpcs> <file> "<label>"
 *   npm run import:code-sets -- icd10cm <icd10cm_order_YYYY.txt> <fiscal year, e.g. 2027>
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
  if (!["ncci_ptp", "ncci_mue", "coverage", "hcpcs", "icd10cm"].includes(set ?? "") || !file || (set === "icd10cm" && !/^\d{4}$/.test(label ?? ""))) {
    console.error('Usage: npm run import:code-sets -- <ncci_ptp|ncci_mue|coverage|hcpcs> <file> "<label>"\n       npm run import:code-sets -- icd10cm <icd10cm_order_YYYY.txt> <fiscal year>');
    process.exit(2);
  }
  const { getDb } = await import("@/db");
  const { importCodeSet } = await import("@/server/code-sets");
  const text = fs.readFileSync(file, "latin1");
  const started = Date.now();
  const r = await importCodeSet(await getDb(), set as "ncci_ptp", text, set === "icd10cm" ? file.split(/[\\/]/).pop()! : label || file, `cli:${process.env.USER ?? process.env.USERNAME ?? "operator"}`, set === "icd10cm" ? Number(label) : undefined);
  console.log(`Loaded ${r.added} rows (${r.skipped} skipped) in ${Math.round((Date.now() - started) / 1000)}s`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
