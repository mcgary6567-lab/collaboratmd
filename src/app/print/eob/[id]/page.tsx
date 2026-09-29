import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { allowedFrom, eobFor } from "@/server/eob";
import { CARC, RARC } from "@/lib/codes/carc";
import { fmtDate, money } from "@/lib/utils";
import { PrintButton } from "../../abn/[id]/print-button";

export const metadata: Metadata = { title: "Explanation of benefits" };
export const dynamic = "force-dynamic";

const adj = (a: { group: string; reason: string; amountCents: number }) => `${a.group}-${a.reason} ${money(a.amountCents)}${CARC[a.reason] ? ` (${CARC[a.reason].description})` : ""}`;

/** The primary payer's adjudication of a claim, from its 835s, to send with a paper claim to the secondary payer. */
export default async function EobPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const e = await eobFor(await getDb(), s.practiceId, id);
  if (!e) notFound();
  return (
    <main className="mx-auto max-w-4xl bg-white p-8 text-slate-900">
      <div className="no-print mb-6 flex flex-wrap gap-3">
        <Link href={`/claims/${id}`} className="btn btn-secondary">Back to claim {e.claim.controlNumber}</Link>
        <PrintButton />
      </div>
      <h1 className="text-xl font-bold">Explanation of benefits: {e.payer.name}</h1>
      <p className="mt-1 text-sm text-slate-700">Rebuilt from the payer&apos;s electronic remittance (835). {e.practice.name} · NPI {e.practice.npi}</p>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div><dt className="font-semibold">Patient</dt><dd>{e.patient.lastName}, {e.patient.firstName}</dd></div>
        <div><dt className="font-semibold">Member ID</dt><dd>{e.insurance.memberId}</dd></div>
        <div><dt className="font-semibold">Date of service</dt><dd>{fmtDate(e.dos)}</dd></div>
        <div><dt className="font-semibold">Our claim / payer&apos;s</dt><dd>{e.claim.controlNumber} / {e.claim.payerClaimNumber ?? "-"}</dd></div>
      </dl>
      {e.payments.length === 0 ? <p className="mt-6 text-sm">No remittance from this payer is on file for the claim yet.</p> : e.payments.map((p) => (
        <section key={`${p.checkNumber}-${p.paymentDate}`} className="mt-6">
          <h2 className="font-bold">Check or EFT {p.checkNumber}, {fmtDate(p.paymentDate)}</h2>
          <p className="text-sm">Charged {money(p.claim.chargedCents)} · allowed {money(allowedFrom(p.claim))} · paid {money(p.claim.paidCents)} · patient responsibility {money(p.claim.patientResponsibilityCents)}</p>
          {p.claim.adjustments.length > 0 && <p className="text-sm">Claim adjustments: {p.claim.adjustments.map(adj).join("; ")}</p>}
          {p.claim.remarks.length > 0 && <p className="text-sm">Remarks: {p.claim.remarks.map((r) => `${r}${RARC[r] ? ` (${RARC[r]})` : ""}`).join("; ")}</p>}
          <table className="mt-2 w-full border-collapse text-sm">
            <thead><tr className="border-b border-slate-300 text-left"><th className="py-1">Service</th><th className="text-right">Units</th><th className="text-right">Charged</th><th className="text-right">Paid</th><th className="pl-3">Adjustments</th></tr></thead>
            <tbody>
              {p.claim.lines.map((l, i) => (
                <tr key={i} className="border-b border-slate-200 align-top">
                  <td className="py-1 font-mono">{[l.cpt, ...l.modifiers].join(" ")}</td>
                  <td className="text-right">{l.units}</td>
                  <td className="text-right">{money(l.chargedCents)}</td>
                  <td className="text-right">{money(l.paidCents)}</td>
                  <td className="pl-3">{l.adjustments.map(adj).join("; ")}{l.remarks.length ? ` · ${l.remarks.join(", ")}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <p className="mt-6 text-xs text-slate-600">Group codes: CO contractual obligation, PR patient responsibility, OA other adjustment, PI payer initiated.</p>
    </main>
  );
}
