import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { ABN_OPTIONS } from "@/server/abn";
import { fmtDate, money } from "@/lib/utils";
import { PrintButton } from "./print-button";

export const metadata: Metadata = { title: "ABN details" };
export const dynamic = "force-dynamic";

const CMS_ABN = "https://www.cms.gov/medicare/forms-notices/beneficiary-notices-initiative/ffs-abn";

/**
 * What goes in each blank of the Advance Beneficiary Notice (form CMS-R-131).
 * CMS requires its own approved form, so this sheet is for filling that form
 * in, not a substitute given to the patient.
 */
export default async function AbnPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const db = await getDb();
  const [row] = await db.select({ abn: schema.abns, patient: schema.patients, practice: schema.practices }).from(schema.abns)
    .innerJoin(schema.patients, eq(schema.patients.id, schema.abns.patientId)).innerJoin(schema.practices, eq(schema.practices.id, schema.abns.practiceId))
    .where(and(eq(schema.abns.id, id), eq(schema.abns.practiceId, s.practiceId))).limit(1);
  if (!row) notFound();
  const { abn, patient, practice } = row;
  const total = abn.services.reduce((a, x) => a + x.estimatedCents, 0);
  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-slate-900">
      <div className="no-print mb-6 flex flex-wrap gap-3">
        <Link href={`/patients/${patient.id}`} className="btn btn-secondary">Back to the patient</Link>
        <PrintButton />
        <a href={CMS_ABN} target="_blank" rel="noreferrer noopener" className="btn btn-secondary">Get form CMS-R-131 from CMS</a>
      </div>
      <h1 className="text-xl font-bold">ABN details for form CMS-R-131</h1>
      <p className="mt-1 text-sm text-slate-700">Medicare requires its own approved form. Copy these details into it; the patient reads it, checks one option, signs and dates it. Keep the signed form with the patient&apos;s record.</p>
      <dl className="mt-6 space-y-4 text-sm">
        <div><dt className="font-semibold">A. Notifier</dt><dd>{practice.name}, {practice.address1}, {practice.city}, {practice.state} {practice.zip}{practice.phone ? `, ${practice.phone}` : ""}</dd></div>
        <div><dt className="font-semibold">B. Patient name</dt><dd>{patient.firstName} {patient.lastName}</dd></div>
        <div><dt className="font-semibold">C. Identification number (optional; never the Medicare number)</dt><dd>{patient.mrn}</dd></div>
        <div>
          <dt className="font-semibold">D. Items or services, E. reason Medicare may not pay, F. estimated cost</dt>
          <dd>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead><tr className="border-b border-slate-300 text-left"><th className="py-1">D. Service</th><th>E. Reason</th><th className="text-right">F. Estimated cost</th></tr></thead>
              <tbody>
                {abn.services.map((x) => (
                  <tr key={x.code} className="border-b border-slate-200"><td className="py-1">{x.description} ({x.code})</td><td>{abn.reason}</td><td className="text-right">{money(x.estimatedCents)}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-right">Total {money(total)}</p>
          </dd>
        </div>
        <div><dt className="font-semibold">Date of service</dt><dd>{fmtDate(abn.serviceDate)}</dd></div>
        <div>
          <dt className="font-semibold">G. Options (the patient checks one on the form)</dt>
          <dd><ul className="list-disc pl-5">{Object.entries(ABN_OPTIONS).map(([k, v]) => <li key={k}>{v}{abn.option === Number(k) ? " (chosen)" : ""}</li>)}</ul></dd>
        </div>
        {abn.signedOn && <div><dt className="font-semibold">I, J. Signed</dt><dd>{fmtDate(abn.signedOn)}</dd></div>}
      </dl>
    </main>
  );
}
