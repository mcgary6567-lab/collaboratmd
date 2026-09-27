import { Zip, ZipDeflate } from "fflate";
import { sql } from "drizzle-orm";
import type { Db } from "@/db";
import { csvCell } from "@/lib/csv-out";
import { attachmentBytes } from "./attachments";
import type { ExportSegment } from "@/db/schema";

/**
 * Everything a practice has in CollaboratMD, as a zip of one CSV per table plus
 * the claim attachments as files, so a practice can leave (or keep its own
 * copy) without asking us. Tables are found from the database itself, so new
 * tables are included without anyone remembering to add them here.
 *
 * Left out: credentials (password hashes, second-factor secrets, sealed keys,
 * tokens) and platform tables that hold no practice data.
 */

const PAGE = 5000;
const SKIP_TABLES = new Set(["auth_throttle", "ops_alerts", "saml_requests", "error_events", "__drizzle_migrations", "schema_migrations"]);
const SECRET_COLUMN = /password|secret|sealed|token|_hash$|^key$|^mfa_|_hint$/;
const FILE_COLUMNS = new Set(["data_base64", "storage_key"]);
const IDENT = /^[a-z_][a-z0-9_]*$/;

type Source = { table: string; filter: "own" | "practice" | { column: string; parent: string } };
export type ExportPlan = { sources: Source[]; columns: Record<string, { keep: string[]; dropped: string[] }> };

const q = (id: string) => {
  if (!IDENT.test(id)) throw new Error(`Unexpected identifier ${id}`);
  return `"${id}"`;
};

/** Which tables belong to a practice, and how to pick its rows from each. */
export async function exportPlan(db: Db): Promise<ExportPlan> {
  const { rows: cols } = await db.execute(sql`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`);
  const { rows: fks } = await db.execute(sql`
    SELECT kcu.table_name AS child, kcu.column_name AS col, ccu.table_name AS parent
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
    JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    ORDER BY kcu.table_name, kcu.column_name`);
  const byTable = new Map<string, string[]>();
  for (const r of cols as { table_name: string; column_name: string }[]) {
    if (!byTable.has(r.table_name)) byTable.set(r.table_name, []);
    byTable.get(r.table_name)!.push(r.column_name);
  }
  const hasPractice = (t: string) => byTable.get(t)?.includes("practice_id") ?? false;
  const sources: Source[] = [];
  const columns: ExportPlan["columns"] = {};
  for (const [table, all] of [...byTable].sort(([a], [b]) => a.localeCompare(b))) {
    if (SKIP_TABLES.has(table) || !IDENT.test(table)) continue;
    let filter: Source["filter"] | null = null;
    if (table === "practices") filter = "own";
    else if (hasPractice(table)) filter = "practice";
    else {
      // A child row belongs to the practice through its parent (a charge through its encounter, say).
      const fk = (fks as { child: string; col: string; parent: string }[]).find((f) => f.child === table && hasPractice(f.parent) && f.parent !== table);
      if (fk) filter = { column: fk.col, parent: fk.parent };
    }
    if (!filter) continue;
    sources.push({ table, filter });
    columns[table] = { keep: all.filter((c) => !SECRET_COLUMN.test(c) && !FILE_COLUMNS.has(c)), dropped: all.filter((c) => SECRET_COLUMN.test(c)) };
  }
  return { sources, columns };
}

function where(s: Source, practiceId: string) {
  if (s.filter === "own") return sql`WHERE id = ${practiceId}`;
  if (s.filter === "practice") return sql`WHERE practice_id = ${practiceId}`;
  return sql`WHERE ${sql.raw(q(s.filter.column))} IN (SELECT id FROM ${sql.raw(q(s.filter.parent))} WHERE practice_id = ${practiceId})`;
}

const enc = new TextEncoder();
const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 80);

/**
 * How to split a large practice's export into parts, each small enough for one
 * run: big tables in id-ordered slices, attachments in groups. A practice that
 * fits in one part gets a single-element plan.
 */
export async function planExportParts(db: Db, practiceId: string, opts: { chunkRows?: number; partRows?: number; filesPerPart?: number } = {}): Promise<ExportSegment[][]> {
  const chunkRows = opts.chunkRows ?? 100_000;
  const partRows = opts.partRows ?? 250_000;
  const filesPerPart = opts.filesPerPart ?? 300;
  const plan = await exportPlan(db);
  const segments: { seg: ExportSegment; rows: number }[] = [];
  for (const s of plan.sources) {
    const table = sql.raw(q(s.table));
    const { rows: [c] } = await db.execute(sql`SELECT count(*)::int AS n FROM ${table} ${where(s, practiceId)}`);
    const n = Number((c as { n: number }).n);
    if (!plan.columns[s.table].keep.includes("id") || n <= chunkRows) {
      segments.push({ seg: { table: s.table, afterId: null, limit: null, label: `tables/${s.table}.csv` }, rows: n });
      continue;
    }
    let after: string | null = null;
    for (let k = 1, left = n; left > 0; k++, left -= chunkRows) {
      segments.push({ seg: { table: s.table, afterId: after, limit: chunkRows, label: `tables/${s.table}.part${k}.csv` }, rows: Math.min(chunkRows, left) });
      const { rows: b }: { rows: unknown[] } = await db.execute(sql`SELECT id::text AS id FROM ${table} ${where(s, practiceId)} ${after === null ? sql`` : sql`AND id > ${after}`} ORDER BY id OFFSET ${chunkRows - 1} LIMIT 1`);
      if (!b.length) break;
      after = (b[0] as { id: string }).id;
    }
  }
  const parts: ExportSegment[][] = [];
  let current: ExportSegment[] = [];
  let size = 0;
  for (const { seg, rows } of segments) {
    if (current.length && size + rows > partRows) { parts.push(current); current = []; size = 0; }
    current.push(seg);
    size += rows;
  }
  const { rows: files } = await db.execute(sql`SELECT id::text AS id FROM claim_attachments WHERE practice_id = ${practiceId} ORDER BY created_at, id`);
  const ids = (files as { id: string }[]).map((f) => f.id);
  if (parts.length === 0 && ids.length <= filesPerPart) return [[...current, { attachments: ids }]];
  if (current.length) parts.push(current);
  for (let i = 0; i < ids.length; i += filesPerPart) parts.push([{ attachments: ids.slice(i, i + filesPerPart) }]);
  return parts;
}

/**
 * The zip, a piece at a time, so a large practice streams out instead of being
 * held in memory (and the response is not subject to the platform's body limit).
 * With `part`, only that part's slices and files, from a plan made by planExportParts.
 */
export async function* practiceExport(db: Db, practiceId: string, now = new Date(), part?: { segments: ExportSegment[]; index: number; total: number }): AsyncGenerator<Uint8Array> {
  const out: Uint8Array[] = [];
  let failed: Error | null = null;
  const zip = new Zip((err, chunk) => { if (err) failed = err; else out.push(chunk); });
  const drain = function* () {
    if (failed) throw failed;
    while (out.length) yield out.shift()!;
  };
  const plan = await exportPlan(db);
  const counts: string[] = [];
  const everything = !part;
  const segments: ExportSegment[] = part?.segments ?? plan.sources.map((s) => ({ table: s.table, afterId: null, limit: null, label: `tables/${s.table}.csv` }));

  for (const seg of segments) {
    if ("attachments" in seg) continue;
    const s = plan.sources.find((x) => x.table === seg.table);
    if (!s) continue;
    const keep = plan.columns[s.table].keep;
    const file = new ZipDeflate(seg.label, { level: 6 });
    zip.add(file);
    file.push(enc.encode(keep.join(",") + "\r\n"), false);
    let n = 0;
    // Keyset paging on id, so the last page costs what the first does; tables without an id fall back to offsets.
    const keyed = keep.includes("id");
    let last: unknown = seg.afterId;
    for (let offset = 0; ; offset += PAGE) {
      const cols = sql.raw(keep.map(q).join(", "));
      const take = seg.limit === null ? PAGE : Math.min(PAGE, seg.limit - n);
      if (take <= 0) break;
      const { rows } = keyed
        ? await db.execute(sql`SELECT ${cols} FROM ${sql.raw(q(s.table))} ${where(s, practiceId)} ${last === null ? sql`` : sql`AND id > ${last}`} ORDER BY id LIMIT ${take}`)
        : await db.execute(sql`SELECT ${cols} FROM ${sql.raw(q(s.table))} ${where(s, practiceId)} ORDER BY 1 LIMIT ${PAGE} OFFSET ${offset}`);
      if (!rows.length) break;
      if (keyed) last = (rows[rows.length - 1] as Record<string, unknown>).id;
      const text = (rows as Record<string, unknown>[]).map((r) => keep.map((c) => csvCell(typeof r[c] === "object" && r[c] !== null && !(r[c] instanceof Date) ? JSON.stringify(r[c]) : r[c])).join(",")).join("\r\n") + "\r\n";
      file.push(enc.encode(text), false);
      n += rows.length;
      yield* drain();
      if (rows.length < take) break;
    }
    file.push(new Uint8Array(0), true);
    counts.push(`${seg.label.replace(/^tables\//, "").replace(/\.csv$/, "")}: ${n} rows`);
    yield* drain();
  }

  // Attachments as the files themselves, one at a time.
  let files = 0;
  const missing: string[] = [];
  let ids: string[];
  if (everything) {
    const { rows } = await db.execute(sql`SELECT id::text AS id FROM claim_attachments WHERE practice_id = ${practiceId} ORDER BY created_at, id`);
    ids = (rows as { id: string }[]).map((r) => r.id);
  } else ids = segments.flatMap((x) => ("attachments" in x ? x.attachments : []));
  for (const id of ids) {
    const { rows } = await db.execute(sql`SELECT filename, data_base64, storage_key FROM claim_attachments WHERE id = ${id} AND practice_id = ${practiceId}`);
    const a = rows[0] as { filename: string; data_base64: string | null; storage_key: string | null } | undefined;
    if (!a) continue;
    // A file missing from storage is listed in the README rather than failing the whole export.
    const bytes = await attachmentBytes({ dataBase64: a.data_base64, storageKey: a.storage_key }).catch(() => null);
    if (!bytes) { missing.push(`${id} (${a.filename})`); continue; }
    const file = new ZipDeflate(`attachments/${id}-${safeName(a.filename)}`, { level: 6 });
    zip.add(file);
    file.push(new Uint8Array(bytes), true);
    files++;
    yield* drain();
  }

  const dropped = Object.entries(plan.columns).filter(([, c]) => c.dropped.length).map(([t, c]) => `${t}: ${c.dropped.join(", ")}`);
  const readme = [
    "CollaboratMD practice export",
    `Created ${now.toISOString()}`,
    ...(part && part.total > 1 ? [`Part ${part.index + 1} of ${part.total}. Download every part; together they are the whole export.`] : []),
    "",
    "tables/  One CSV per table, all rows that belong to this practice. Amounts are in cents.",
    "         Dates and times are UTC. JSON columns are written as JSON text.",
    "         A large table is split into table.part1.csv, table.part2.csv and so on, in id order.",
    "attachments/  Claim attachments, named <attachment id>-<original file name>.",
    "",
    "The export is taken table by table, so a change made while it ran may appear in some files and not others.",
    "",
    "Rows in this file:",
    ...counts.map((c) => `  ${c}`),
    `  attachments: ${files} files`,
    ...(missing.length ? ["", "Attachments that could not be read from file storage:", ...missing.map((m) => `  ${m}`)] : []),
    "",
    "Left out on purpose (credentials, not data):",
    ...(dropped.length ? dropped.map((d) => `  ${d}`) : ["  none"]),
    "",
  ].join("\r\n");
  const r = new ZipDeflate("README.txt", { level: 6 });
  zip.add(r);
  r.push(enc.encode(readme), true);
  zip.end();
  yield* drain();
}
