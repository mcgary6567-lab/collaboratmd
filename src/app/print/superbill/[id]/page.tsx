import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getDb } from "@/db";
import { logPatientView } from "@/lib/log-view";
import { superbillFor } from "@/server/superbill";
import { fmtDate, money } from "@/lib/utils";
import { PrintButton } from "../../abn/[id]/print-button";

export const metadata: Metadata = { title: "Superbill" };
export const dynamic = "force-dynamic";

const POS: Record<string, string> = { "02": "Telehealth (not in home)", "10": "Telehealth in patient's home", "11": "Office", "12": "Home", "19": "Outpatient hospital (off campus)", "22": "Outpatient hospital", "21": "Inpatient hospital", "23": "Emergency room", "31": "Skilled nursing facility", "32": "Nursing facility" };

/** An itemized visit for the patient to file with their own insurer (out-of-network reimbursement). */
export default async function SuperbillPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const sb = await superbillFor(await getDb(), s.practiceId, id);
  if (!sb) notFound();
  await logPatientView(s, sb.p.id, "superbill", id);
  const { practice: pr, prov, p, e } = sb;
  const day = (v: string) => fmtDate(`${v}T00:00:00`);
  return (
    <main className="mx-auto max-w-3xl bg-white p-4 text-sm text-slate-900 sm:p-10">
      <div className="no-print mb-6 flex flex-wrap gap-3">
        <Link href={`/patients/${p.id}`} className="btn btn-secondary">Back to the patient</Link>
        <PrintButton />
      </div>
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold">{pr.name}</h1>
          <p>{pr.address1}<br />{pr.city}, {pr.state} {pr.zip}{pr.phone ? <><br />{pr.phone}</> : null}</p>
        </div>
        <div className="text-right">
          <p className="text-base font-bold">Superbill</p>
          <p>Tax ID (EIN): {pr.taxId}<br />Group NPI: {pr.npi}</p>
        </div>
      </div>
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <p className="font-semibold">Patient</p>
          <p>{p.firstName} {p.lastName}<br />Date of birth: {day(p.dob)}{p.address1 ? <><br />{p.address1}<br />{p.city}, {p.state} {p.zip}</> : null}</p>
          {sb.insurance && <p className="mt-1">Insurance: {sb.insurance.payer}, member ID {sb.insurance.memberId}</p>}
        </div>
        <div>
          <p className="font-semibold">Rendering provider</p>
          <p>{prov.firstName} {prov.lastName}{prov.credential ? `, ${prov.credential}` : ""}<br />NPI: {prov.npi}<br />Taxonomy: {prov.taxonomy}</p>
          <p className="mt-1">Date of service: {day(e.dateOfService)}<br />Place of service: {e.placeOfService} {POS[e.placeOfService] ? `(${POS[e.placeOfService]})` : ""}{sb.location ? <><br />{sb.location.name}</> : null}</p>
        </div>
      </div>
      <h2 className="mt-6 font-semibold">Diagnoses (ICD-10-CM)</h2>
      <table className="mt-1 w-full text-left">
        <tbody>{sb.diagnoses.map((d) => <tr key={d.code} className="border-b border-slate-100"><td className="w-8 py-1">{d.pointer}</td><td className="w-24 font-mono">{d.code}</td><td>{d.description ?? ""}</td></tr>)}</tbody>
      </table>
      <h2 className="mt-6 font-semibold">Services</h2>
      <div tabIndex={0} role="region" aria-label="Services" className="overflow-x-auto"><table className="mt-1 w-full text-left">
        <thead><tr className="border-b border-slate-300"><th className="py-1">Code</th><th>Modifiers</th><th>Description</th><th>Diagnosis</th><th className="text-right">Units</th><th className="text-right">Charge</th></tr></thead>
        <tbody>{sb.items.map((i) => (
          <tr key={i.lineNumber} className="border-b border-slate-100 align-top">
            <td className="py-1 font-mono">{i.cpt}</td>
            <td className="font-mono">{i.modifiers.join(" ")}</td>
            <td>{i.description}</td>
            <td>{i.dxPointers.map((n) => String.fromCharCode(64 + n)).join("")}</td>
            <td className="text-right tabular-nums">{i.units}</td>
            <td className="text-right tabular-nums">{money(i.chargeCents)}</td>
          </tr>
        ))}</tbody>
      </table></div>
      <div className="mt-3 ml-auto w-64 space-y-1">
        <div className="flex justify-between"><span>Total charges</span><span className="tabular-nums">{money(sb.totalCents)}</span></div>
        <div className="flex justify-between"><span>Paid by the patient</span><span className="tabular-nums">{money(sb.paidCents)}</span></div>
        <div className="flex justify-between font-semibold"><span>Balance</span><span className="tabular-nums">{money(Math.max(0, sb.totalCents - sb.paidCents))}</span></div>
      </div>
      <p className="mt-8 leading-relaxed">To ask your insurance plan to reimburse you, send this superbill with the plan&apos;s claim form, following the plan&apos;s instructions for out-of-network claims. Payment from your plan, if any, goes to you.</p>
      <p className="mt-6">Provider signature: ______________________________ Date: ____________</p>
    </main>
  );
}
