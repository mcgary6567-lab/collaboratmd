import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { loadClaimBundle } from "@/server/claims";
import { listAttachments, REPORT_TYPES } from "@/server/attachments";
import { PrintButton } from "@/components/action-form";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

/** Cover sheet for faxing or mailing a claim's attachments: what the payer needs to match them to the claim. */
export default async function CoverSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const b = await loadClaimBundle(db, id);
  if (!b || b.claim.practiceId !== s.practiceId) notFound();
  const files = await listAttachments(db, s.practiceId, id);

  return (
    <>
      <div className="no-print mb-4 flex gap-2">
        <Link href={`/claims/${id}`} className="btn btn-secondary">Back to the claim</Link>
        <PrintButton label="Print cover sheet" />
      </div>
      <article className="card mx-auto max-w-2xl p-8 text-sm text-slate-800">
        <h1 className="text-xl font-bold">Claim attachment</h1>
        <p className="text-slate-600">Additional documentation for the claim below. Please match it by the attachment control number.</p>
        <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-2">
          <dt className="text-slate-500">To</dt><dd className="font-semibold">{b.payer.name}</dd>
          <dt className="text-slate-500">From</dt><dd>{b.practice.name}, NPI {b.practice.npi}</dd>
          <dt className="text-slate-500">Patient</dt><dd>{b.patient.firstName} {b.patient.lastName}, born {fmtDate(`${b.patient.dob}T00:00:00`)}</dd>
          <dt className="text-slate-500">Member ID</dt><dd className="font-mono">{b.insurance.memberId}</dd>
          <dt className="text-slate-500">Date of service</dt><dd>{fmtDate(`${b.encounter.dateOfService}T00:00:00`)}</dd>
          <dt className="text-slate-500">Our claim number</dt><dd className="font-mono">{b.claim.controlNumber}</dd>
          {b.claim.payerClaimNumber && <><dt className="text-slate-500">Your claim number</dt><dd className="font-mono">{b.claim.payerClaimNumber}</dd></>}
          <dt className="text-slate-500">Billed</dt><dd>${(b.claim.totalCents / 100).toFixed(2)}</dd>
        </dl>
        <table className="mt-6 w-full">
          <thead><tr className="border-b border-slate-300 text-left"><th className="py-1">Attachment control number</th><th>Document</th></tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.id} className="border-b border-slate-100"><td className="py-1 font-mono text-base font-semibold">{f.controlNumber}</td><td>{REPORT_TYPES[f.reportType] ?? f.reportType} ({f.filename})</td></tr>
            ))}
          </tbody>
        </table>
        <p className="mt-6 text-xs text-slate-500">This transmission contains protected health information for the payer named above. If you received it in error, notify the sender and destroy it.</p>
      </article>
    </>
  );
}
