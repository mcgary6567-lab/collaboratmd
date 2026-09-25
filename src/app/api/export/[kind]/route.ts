import { getDb, schema } from "@/db";
import { getSession } from "@/lib/auth";
import { toCsv, dollars } from "@/lib/csv-out";
import { searchClaims, searchDenials } from "@/server/lists";
import { arAging, payerPerformance } from "@/server/analytics";

export const dynamic = "force-dynamic";

const MAX_ROWS = 50_000;

/**
 * CSV exports of the lists and reports, using the same filters as the page
 * (the query string). Signed-in users only, scoped to their practice, and
 * each export is recorded in the audit log because it takes data off the
 * platform.
 */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (session.role === "front_desk") return new Response("Exports are for billers and administrators", { status: 403 });
  const { kind } = await params;
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const db = await getDb();
  let headers: string[];
  let rows: unknown[][];

  if (kind === "claims") {
    const r = await searchClaims(db, session.practiceId, { q: q.q, status: q.status, payerId: q.payer, from: q.from, to: q.to, sort: q.sort, dir: q.dir, offset: 0, limit: MAX_ROWS });
    headers = ["Claim", "Patient", "MRN", "Date of service", "Payer", "Status", "Billed", "Payer claim number", "Timely filing deadline", "Submitted"];
    rows = r.rows.map(({ claim, patient, payer, encounter }) => [
      claim.controlNumber, `${patient.lastName}, ${patient.firstName}`, patient.mrn, encounter.dateOfService, payer.name, claim.status,
      dollars(claim.totalCents), claim.payerClaimNumber, claim.timelyFilingDeadline, claim.submittedAt,
    ]);
  } else if (kind === "denials") {
    const r = await searchDenials(db, session.practiceId, { q: q.q, status: q.status === "" ? undefined : q.status ?? "open", category: q.category, sort: q.sort, dir: q.dir, offset: 0, limit: MAX_ROWS });
    headers = ["Claim", "Patient", "Payer", "CARC", "RARC", "Category", "Amount", "Status", "Appeal deadline", "Received"];
    rows = r.rows.map(({ denial, claim, patient, payer }) => [
      claim.controlNumber, `${patient.lastName}, ${patient.firstName}`, payer.name, denial.carc, denial.rarc, denial.category,
      dollars(denial.amountCents), denial.status, denial.appealDeadline, denial.createdAt,
    ]);
  } else if (kind === "ar-aging") {
    const r = await arAging(db, session.practiceId);
    headers = ["Payer", "0-30", "31-60", "61-90", "91-120", "Over 120", "Total"];
    rows = [...r.rows, r.totals].map((a) => [a.label, dollars(a.b0_30), dollars(a.b31_60), dollars(a.b61_90), dollars(a.b91_120), dollars(a.b120p), dollars(a.total)]);
  } else if (kind === "payer-performance") {
    const r = await payerPerformance(db, session.practiceId, 100);
    headers = Object.keys(r[0] ?? { payer: "" });
    rows = r.map((x) => headers.map((h) => (x as Record<string, unknown>)[h]));
  } else {
    return new Response("Unknown export", { status: 404 });
  }

  await db.insert(schema.auditLog).values({ practiceId: session.practiceId, userId: session.userId, action: "export", entity: kind, entityId: null, details: { rows: rows.length, filters: q } });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
