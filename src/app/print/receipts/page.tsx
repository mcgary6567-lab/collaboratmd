import type { Metadata } from "next";
import Link from "next/link";
import { eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import { langOf } from "@/lib/i18n/messages";
import { restrictedPatientIds } from "@/server/restricted";
import { patientsWithPayments, yearReceipt } from "@/server/receipts";
import { PaymentReceipt } from "@/components/payment-receipt";
import { PrintButton } from "../abn/[id]/print-button";

export const metadata: Metadata = { title: "Year-end receipts" };
export const dynamic = "force-dynamic";

const PER_BATCH = 100;

/** Every patient who paid in the year, one receipt per printed page, in batches. */
export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ year?: string; batch?: string }> }) {
  const s = await requireRole(CAN_WRITE);
  const q = await searchParams;
  const year = Number(q.year) || new Date().getUTCFullYear() - 1;
  const batch = Math.max(0, Number(q.batch) || 0);
  const db = await getDb();
  const [practice] = await db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
  const list = await patientsWithPayments(db, s.practiceId, year, PER_BATCH + 1, batch * PER_BATCH);
  const more = list.length > PER_BATCH;
  const restricted = new Set(await restrictedPatientIds(db, s.practiceId));
  const printable = list.slice(0, PER_BATCH).filter((p) => !restricted.has(p.patientId));
  const skipped = list.slice(0, PER_BATCH).filter((p) => restricted.has(p.patientId));
  const people = printable.length ? await db.select().from(schema.patients).where(inArray(schema.patients.id, printable.map((p) => p.patientId))) : [];
  const byId = new Map(people.map((p) => [p.id, p]));
  const receipts = await Promise.all(printable.map((p) => yearReceipt(db, s.practiceId, p.patientId, year)));
  return (
    <main className="bg-white p-6">
      <div className="no-print mx-auto mb-6 max-w-3xl space-y-3">
        <h1 className="text-xl font-bold">Year-end receipts, {year}</h1>
        <p className="text-sm text-slate-600">
          {printable.length} receipt{printable.length === 1 ? "" : "s"} in this batch (patients {batch * PER_BATCH + 1} to {batch * PER_BATCH + list.slice(0, PER_BATCH).length}), one per page.
          {skipped.length > 0 && ` ${skipped.length} restricted record${skipped.length === 1 ? " is" : "s are"} left out; print ${skipped.length === 1 ? "it" : "them"} from the patient's page.`}
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/billing" className="btn btn-secondary">Back to patient billing</Link>
          {batch > 0 && <Link href={`/print/receipts?year=${year}&batch=${batch - 1}`} className="btn btn-secondary">Previous batch</Link>}
          {more && <Link href={`/print/receipts?year=${year}&batch=${batch + 1}`} className="btn btn-secondary">Next batch</Link>}
          <PrintButton />
        </div>
      </div>
      <div className="space-y-6">
        {printable.map((p, i) => {
          const patient = byId.get(p.patientId);
          return patient ? <PaymentReceipt key={p.patientId} receipt={receipts[i]} practice={practice} patient={patient} lang={langOf(patient.preferredLanguage)} /> : null;
        })}
      </div>
    </main>
  );
}
