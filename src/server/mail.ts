/**
 * Paper statements through Lob (https://docs.lob.com): the statement is sent
 * as HTML, printed, and mailed first class. The letter gets a blank address
 * page of its own (address_placement "insert_blank_page"), so the statement
 * layout never collides with the envelope window; that costs an extra sheet
 * per letter.
 *
 * A test_ key renders letters in Lob's dashboard without printing or mailing,
 * which is how to check the layout before switching to a live_ key.
 */
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { practiceConfig } from "./integrations";
import { getStatement } from "./billing";
import { langOf } from "@/lib/i18n/messages";
import { STATEMENT_TEXT, statementDay } from "@/lib/i18n/statement";
import { billTo } from "./patient-accounts";

const { statements, auditLog } = schema;
const LOB_LETTERS = "https://api.lob.com/v1/letters";
/**
 * Inline HTML is kept under 10,000 characters, which we understand to be Lob's
 * cap for an HTML string (a hosted template has no such cap); statements that
 * would be longer list fewer visits.
 */
const HTML_LIMIT = 10_000;

type Http = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type StatementRow = NonNullable<Awaited<ReturnType<typeof getStatement>>>;

const esc = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const usd = (cents: number) => `$${(cents / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;

/** The letter, in the patient's preferred language. */
export function statementLetterHtml(row: StatementRow, maxVisits = 15): string {
  const { statement: st, patient: p, practice: pr } = row;
  const lang = langOf(p.preferredLanguage);
  const t = STATEMENT_TEXT[lang];
  const day = (iso: string | null) => statementDay(lang, iso);
  const build = (n: number) => {
    const visits = st.detail.visits.slice(0, n);
    const more = st.detail.visits.length - visits.length;
    return `<html lang="${lang}"><head><meta charset="utf-8"><style>
body{font-family:Helvetica,Arial,sans-serif;font-size:10pt;color:#111;margin:0.5in}
h1{font-size:13pt;margin:0}table{width:100%;border-collapse:collapse;margin-top:8pt}
td,th{padding:3pt 4pt;border-bottom:1px solid #ddd;text-align:left}th{font-size:8pt;text-transform:uppercase;color:#444}
.r{text-align:right}.due{border:2px solid #111;padding:8pt;margin:10pt 0;text-align:center}.big{font-size:18pt;font-weight:bold}
</style></head><body>
<h1>${esc(pr.name)}</h1><div>${esc(pr.address1)}, ${esc(pr.city)}, ${esc(pr.state)} ${esc(pr.zip)}${pr.phone ? ` &middot; ${esc(pr.phone)}` : ""}</div>
<p>${t.statement} ${esc(st.statementNumber)} &middot; ${esc(day(st.statementDate))} &middot; ${t.account} ${esc(p.mrn)}<br>${t.statementFor} ${esc(p.firstName)} ${esc(p.lastName)}</p>
<div class="due">${t.amountDue}<div class="big">${usd(st.amountDueCents)}</div>${esc(t.payBy(day(st.dueDate)))}</div>
<table><tr><td>${t.charges}</td><td class="r">${usd(st.chargesCents)}</td></tr>
<tr><td>${t.insurancePaid}</td><td class="r">-${usd(st.insurancePaidCents)}</td></tr>
<tr><td>${t.adjustments}</td><td class="r">-${usd(st.adjustmentsCents)}</td></tr>
<tr><td>${t.youPaid}</td><td class="r">-${usd(st.patientPaidCents)}</td></tr>
<tr><th>${t.balance}</th><th class="r">${usd(st.amountDueCents)}</th></tr></table>
<table><tr><th>${t.visit}</th><th>${t.services}</th><th class="r">${t.chargesCol}</th><th class="r">${t.insurancePaidCol}</th><th class="r">${t.youOwe}</th></tr>
${visits.map((v) => `<tr><td>${esc(day(v.dateOfService))}</td><td>${esc(v.services.map((x) => x.description || x.cpt).join(", ").slice(0, 80))}</td><td class="r">${usd(v.chargesCents)}</td><td class="r">${usd(v.insurancePaidCents)}</td><td class="r">${usd(v.youOweCents)}</td></tr>`).join("")}
${more > 0 ? `<tr><td colspan="5">${esc(t.moreVisits(more))}</td></tr>` : ""}</table>
<p>${t.letterHowToPay(esc(pr.phone ?? t.ourOffice), esc(pr.name), esc(p.mrn))}</p>
<p>${esc(t.letterHelp(pr.phone ?? t.callOffice))}</p>
</body></html>`;
  };
  let n = maxVisits;
  let html = build(n);
  while (html.length > HTML_LIMIT && n > 1) html = build(--n);
  return html;
}

function mailable(p: StatementRow["patient"]) {
  const zip = (p.zip ?? "").replace(/[^\d]/g, "");
  return !!(p.address1?.trim() && p.city?.trim() && /^[A-Z]{2}$/i.test(p.state ?? "") && /^\d{5}(\d{4})?$/.test(zip));
}

export async function mailStatement(db: Db, practiceId: string, statementId: string, opts: { userId?: string; http?: Http } = {}) {
  const lob = (await practiceConfig(db, practiceId)).lob;
  if (!lob) throw new Error("Connect Lob under Integrations to mail statements");
  const row = await getStatement(db, practiceId, statementId);
  if (!row) throw new Error("Statement not found");
  const { statement: st, patient, practice: pr } = row;
  // A family account's statements go to the guarantor.
  const p = (await billTo(db, patient.id)) ?? patient;
  if (st.status === "void") throw new Error("This statement is void");
  if (st.mailId) throw new Error("This statement was already mailed");
  if (!mailable(p)) throw new Error(p.id === patient.id ? "The patient's mailing address is incomplete" : "The guarantor's mailing address is incomplete");
  const zip = (z: string | null) => {
    const d = (z ?? "").replace(/[^\d]/g, "");
    return d.length === 9 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
  };
  const body = {
    description: `Statement ${st.statementNumber}`,
    to: { name: `${p.firstName} ${p.lastName}`.slice(0, 40), address_line1: p.address1!.slice(0, 64), address_city: p.city, address_state: p.state!.toUpperCase(), address_zip: zip(p.zip), address_country: "US" },
    from: { company: pr.name.slice(0, 40), address_line1: pr.address1.slice(0, 64), address_city: pr.city, address_state: pr.state, address_zip: zip(pr.zip), address_country: "US" },
    file: statementLetterHtml(row),
    color: false,
    use_type: "operational",
    address_placement: "insert_blank_page",
    metadata: { statement_id: st.id },
  };
  const http = opts.http ?? (fetch as unknown as Http);
  const res = await http(LOB_LETTERS, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${lob.apiKey}:`).toString("base64")}`, "Content-Type": "application/json", "Idempotency-Key": `statement-${st.id}` },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { id?: string; expected_delivery_date?: string; error?: { message?: string } };
  if (!res.ok || !json.id) throw new Error(`Lob refused the letter: ${json.error?.message ?? res.status}`);
  const test = lob.apiKey.startsWith("test_");
  await db.update(statements).set({ status: "sent", channel: "mail", sentAt: new Date(), mailId: json.id, mailStatus: test ? "test" : "submitted", mailedAt: new Date() })
    .where(and(eq(statements.id, st.id), eq(statements.practiceId, practiceId)));
  await db.insert(auditLog).values({ practiceId, userId: opts.userId ?? null, action: "statement_mailed", entity: "statement", entityId: st.id, details: { lobId: json.id, test } });
  return { lobId: json.id, expectedDelivery: json.expected_delivery_date ?? null, test };
}

/** Every generated, unsent statement with a complete address, up to `limit`. Failures are reported, not thrown. */
export async function mailUnsentStatements(db: Db, practiceId: string, opts: { userId?: string; http?: Http; limit?: number } = {}) {
  const rows = await db.select({ id: statements.id, patientId: statements.patientId }).from(statements)
    .where(and(eq(statements.practiceId, practiceId), eq(statements.status, "generated"), isNull(statements.mailId))).limit(opts.limit ?? 200);
  const people = rows.length ? await db.select().from(schema.patients).where(inArray(schema.patients.id, rows.map((r) => r.patientId))) : [];
  const ok = new Set(people.filter((p) => mailable({ ...p } as StatementRow["patient"])).map((p) => p.id));
  const result = { mailed: 0, skipped: rows.filter((r) => !ok.has(r.patientId)).length, failed: [] as string[] };
  for (const r of rows.filter((x) => ok.has(x.patientId))) {
    try {
      await mailStatement(db, practiceId, r.id, opts);
      result.mailed++;
    } catch (e) {
      result.failed.push(e instanceof Error ? e.message : "failed");
      if (result.failed.length >= 3 && result.mailed === 0) break; // a bad key fails every letter; stop early
    }
  }
  return result;
}
