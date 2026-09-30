/**
 * Loads a CMS code-set file into the database, for files too large to upload.
 *
 *   npm run import:code-sets -- <ncci_ptp|ncci_mue|coverage|hcpcs> <file> "<label>"
 *   npm run import:code-sets -- icd10cm <icd10cm_order_YYYY.txt> <fiscal year, e.g. 2027>
 *   npm run import:code-sets -- icd10cm_addenda <icd10cm_order_addenda_YYYY.txt> <fiscal year>
 *   npm run import:code-sets -- order_referring <Order and Referring CSV> "<label>"
 *
 * When loading an icd10cm order file, the year's addenda file beside it (same
 * folder, from the same CMS download) is loaded right after it.
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
  const yearly = set === "icd10cm" || set === "icd10cm_addenda";
  if (!["ncci_ptp", "ncci_mue", "coverage", "hcpcs", "icd10cm", "icd10cm_addenda", "order_referring"].includes(set ?? "") || !file || (yearly && !/^\d{4}$/.test(label ?? ""))) {
    console.error('Usage: npm run import:code-sets -- <ncci_ptp|ncci_mue|coverage|hcpcs|order_referring> <file> "<label>"\n       npm run import:code-sets -- <icd10cm|icd10cm_addenda> <icd10cm_order[_addenda]_YYYY.txt> <fiscal year>');
    process.exit(2);
  }
  const { getDb } = await import("@/db");
  const { importCodeSet } = await import("@/server/code-sets");
  const db = await getDb();
  const by = `cli:${process.env.USER ?? process.env.USERNAME ?? "operator"}`;
  const load = async (kind: string, path: string) => {
    const started = Date.now();
    const r = await importCodeSet(db, kind as "ncci_ptp", fs.readFileSync(path, "latin1"), yearly ? path.split(/[\\/]/).pop()! : label || path, by, yearly ? Number(label) : undefined);
    console.log(`${path}: loaded ${r.added} rows (${r.skipped} skipped) in ${Math.round((Date.now() - started) / 1000)}s`);
  };
  await load(set, file);
  // The same CMS download has the year's addenda: load it too, so the year before is known.
  const addenda = file.replace(/icd10cm_order_(\d{4})\.txt$/i, "icd10cm_order_addenda_$1.txt");
  if (set === "icd10cm" && addenda !== file && fs.existsSync(addenda)) await load("icd10cm_addenda", addenda);
  else if (set === "icd10cm") console.log(`No ${addenda.split(/[\\/]/).pop()} beside it: load the year's addenda too, or dates of service before October 1 may be refused`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
