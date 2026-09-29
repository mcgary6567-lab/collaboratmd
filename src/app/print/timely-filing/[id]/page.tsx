import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { timelyFilingProof } from "@/server/timely-filing";
import { fmtDate } from "@/lib/utils";
import { PrintButton } from "../../abn/[id]/print-button";

export const metadata: Metadata = { title: "Proof of timely filing" };
export const dynamic = "force-dynamic";

/** The claim's electronic submission record, to send with a timely filing appeal. */
export default async function TimelyFilingPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const p = await timelyFilingProof(await getDb(), s.practiceId, id);
  if (!p) notFound();
  return (
    <main className="mx-auto max-w-3xl bg-white p-8 text-slate-900">
      <div className="no-print mb-6 flex flex-wrap gap-3">
        <Link href={`/claims/${id}`} className="btn btn-secondary">Back to claim {p.claim.controlNumber}</Link>
        <PrintButton />
      </div>
      <h1 className="text-xl font-bold">Proof of timely filing</h1>
      <p className="mt-1 text-sm text-slate-700">{p.practice.name} · NPI {p.practice.npi} · Tax ID {p.practice.taxId}</p>
      <dl className="mt-6 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="font-semibold">Payer</dt><dd>{p.payer.name}</dd></div>
        <div><dt className="font-semibold">Patient</dt><dd>{p.patient.lastName}, {p.patient.firstName}</dd></div>
        <div><dt className="font-semibold">Date of service</dt><dd>{fmtDate(p.dos)}</dd></div>
        <div><dt className="font-semibold">Payer claim number</dt><dd>{p.claim.payerClaimNumber ?? "-"}</dd></div>
        <div><dt className="font-semibold">First submitted</dt><dd>{p.firstSubmittedOn ? `${fmtDate(p.firstSubmittedOn)} (${p.daysAfterService} days after the date of service)` : "Not submitted"}</dd></div>
        <div><dt className="font-semibold">Payer&apos;s filing limit</dt><dd>{p.limitDays} days{p.firstSubmittedOn ? (p.inTime ? ": within the limit" : ": after the limit") : ""}</dd></div>
      </dl>
      <h2 className="mt-8 font-bold">Electronic submissions</h2>
      {p.submissions.length === 0 ? <p className="mt-2 text-sm">No electronic submission is on record for this claim.</p> : (
        <table className="mt-2 w-full border-collapse text-sm">
          <thead><tr className="border-b border-slate-300 text-left"><th className="py-1">Claim</th><th>Submitted</th><th>Acknowledgments</th></tr></thead>
          <tbody>
            {p.submissions.map((x) => (
              <tr key={x.controlNumber} className="border-b border-slate-200 align-top">
                <td className="py-1 font-mono">{x.controlNumber}{x.frequencyCode !== "1" ? ` (frequency ${x.frequencyCode})` : ""}</td>
                <td>{fmtDate(x.submittedOn)}</td>
                <td>{x.acks.length ? x.acks.map((a) => <div key={`${a.kind}-${a.on}`}>{a.kind} {a.accepted ? "accepted" : "rejected"}{a.code ? ` (${a.code})` : ""} on {fmtDate(a.on)}</div>) : "None received"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-6 text-xs text-slate-600">999: the clearinghouse accepted the file. 277CA: the claim was accepted for processing. Earlier claims in this list were corrected or replaced by the later ones and are the same service.</p>
    </main>
  );
}
