import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { logPatientView } from "@/lib/log-view";
import { langOf } from "@/lib/i18n/messages";
import { restrictedAccess } from "@/server/restricted";
import { RestrictedGate } from "@/components/restricted-gate";
import { yearReceipt } from "@/server/receipts";
import { PaymentReceipt } from "@/components/payment-receipt";
import { PrintButton } from "../../abn/[id]/print-button";

export const metadata: Metadata = { title: "Payment receipt" };
export const dynamic = "force-dynamic";

/** A patient's payments for one year, for their HSA, FSA or taxes. */
export default async function ReceiptPage({ params, searchParams }: { params: Promise<{ patientId: string }>; searchParams: Promise<{ year?: string }> }) {
  const s = await requireSession();
  const { patientId } = await params;
  const year = Number((await searchParams).year) || new Date().getUTCFullYear() - 1;
  const db = await getDb();
  const [row] = await db.select({ patient: schema.patients, practice: schema.practices }).from(schema.patients)
    .innerJoin(schema.practices, eq(schema.practices.id, schema.patients.practiceId))
    .where(and(eq(schema.patients.id, patientId), eq(schema.patients.practiceId, s.practiceId))).limit(1);
  if (!row) notFound();
  const gate = await restrictedAccess(db, s, patientId);
  if (!gate.granted) return <RestrictedGate patientId={patientId} back={`/print/receipt/${patientId}?year=${year}`} what="receipt" />;
  await logPatientView(s, patientId, "receipt", patientId);
  const receipt = await yearReceipt(db, s.practiceId, patientId, year);
  return (
    <main className="bg-white p-6">
      <div className="no-print mx-auto mb-6 flex max-w-3xl flex-wrap items-center gap-3">
        <Link href={`/patients/${patientId}`} className="btn btn-secondary">Back to {row.patient.firstName} {row.patient.lastName}</Link>
        <Link href={`/print/receipt/${patientId}?year=${year - 1}`} className="btn btn-secondary">{year - 1}</Link>
        <Link href={`/print/receipt/${patientId}?year=${year + 1}`} className="btn btn-secondary">{year + 1}</Link>
        <PrintButton />
      </div>
      <PaymentReceipt receipt={receipt} practice={row.practice} patient={row.patient} lang={langOf(row.patient.preferredLanguage)} />
    </main>
  );
}
