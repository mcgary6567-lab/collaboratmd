import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { logPatientView } from "@/lib/log-view";
import { restrictedAccess } from "@/server/restricted";
import { RestrictedGate } from "@/components/restricted-gate";
import { accountingOfDisclosures, PURPOSES, ACCOUNTING_YEARS } from "@/server/disclosures";
import { fmtDate } from "@/lib/utils";
import { PrintButton } from "../../abn/[id]/print-button";

export const metadata: Metadata = { title: "Accounting of disclosures" };
export const dynamic = "force-dynamic";

/** The accounting of disclosures a patient can ask for (45 CFR 164.528), for the six years before today. */
export default async function DisclosuresPrintPage({ params }: { params: Promise<{ patientId: string }> }) {
  const s = await requireSession();
  const { patientId } = await params;
  const db = await getDb();
  const [row] = await db.select({ patient: schema.patients, practice: schema.practices }).from(schema.patients)
    .innerJoin(schema.practices, eq(schema.practices.id, schema.patients.practiceId))
    .where(and(eq(schema.patients.id, patientId), eq(schema.patients.practiceId, s.practiceId))).limit(1);
  if (!row) notFound();
  const gate = await restrictedAccess(db, s, patientId);
  if (!gate.granted) return <RestrictedGate patientId={patientId} back={`/print/disclosures/${patientId}`} what="accounting of disclosures" />;
  await logPatientView(s, patientId, "disclosures", patientId);
  const a = await accountingOfDisclosures(db, s.practiceId, patientId);
  const { patient, practice } = row;
  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-slate-900">
      <div className="no-print mb-6 flex flex-wrap gap-3">
        <Link href="/privacy-requests" className="btn btn-secondary">Back to privacy requests</Link>
        <PrintButton />
      </div>
      <p className="text-sm">{practice.name} · {practice.address1}, {practice.city}, {practice.state} {practice.zip}{practice.phone ? ` · ${practice.phone}` : ""}</p>
      <h1 className="mt-4 text-xl font-bold">Accounting of disclosures</h1>
      <p className="mt-1 text-sm">For {patient.firstName} {patient.lastName} (date of birth {fmtDate(`${patient.dob}T00:00:00`)}), covering {fmtDate(`${a.from}T00:00:00`)} to {fmtDate(`${a.to}T00:00:00`)}.</p>
      {a.rows.length === 0 ? (
        <p className="mt-6 text-sm">We have no disclosures of your health information to report for this period.</p>
      ) : (
        <table className="mt-6 w-full border-collapse text-sm">
          <thead><tr className="border-b border-slate-300 text-left"><th className="py-1 pr-3">Date</th><th className="pr-3">Disclosed to</th><th className="pr-3">What was disclosed</th><th>Purpose</th></tr></thead>
          <tbody>
            {a.rows.map((d) => (
              <tr key={d.id} className="border-b border-slate-200 align-top">
                <td className="py-1 pr-3 whitespace-nowrap">{fmtDate(`${d.disclosedOn}T00:00:00`)}</td>
                <td className="pr-3">{d.recipient}{d.recipientAddress && <div className="text-xs text-slate-600">{d.recipientAddress}</div>}</td>
                <td className="pr-3">{d.description}</td>
                <td>{PURPOSES[d.purpose]?.label ?? d.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-8 text-xs text-slate-600">
        This accounting lists disclosures of your health information made in the {ACCOUNTING_YEARS} years before the date above. As the law allows, it does not include disclosures for your treatment,
        for payment or for our health care operations, disclosures to you, or disclosures you authorized in writing. The first accounting you ask for in any 12 months is free.
        Questions: contact {practice.name}{practice.phone ? ` at ${practice.phone}` : ""}.
      </p>
    </main>
  );
}
