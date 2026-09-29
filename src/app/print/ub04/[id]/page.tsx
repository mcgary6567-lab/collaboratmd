import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { loadClaimBundle } from "@/server/claims";
import { money } from "@/lib/utils";
import { PrintButton } from "../../abn/[id]/print-button";

export const metadata: Metadata = { title: "UB-04 claim" };
export const dynamic = "force-dynamic";

/** FL59 patient's relationship to the insured. */
const RELATIONSHIP: Record<string, string> = { self: "18 Self", spouse: "01 Spouse", child: "19 Child", other: "G8 Other" };
const mdy = (iso: string | null | undefined) => (iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "");
const dx = (c: string) => c.replace(".", "").toUpperCase();

function Box({ fl, label, children, className = "" }: { fl: string; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`border border-slate-400 px-2 py-1 ${className}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-600">{fl} {label}</div>
      <div className="min-h-5 font-mono text-sm">{children}</div>
    </div>
  );
}

/**
 * A facility claim laid out by UB-04 form locator on plain paper, for a payer
 * that accepts a printed copy or for review. It is not aligned to the red
 * OCR form: payers that scan paper UB-04s need it printed on that form by
 * billing software aligned to it, or the claim sent electronically (837I).
 */
export default async function Ub04Page({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const b = await loadClaimBundle(await getDb(), id);
  if (!b || b.claim.practiceId !== s.practiceId || b.claim.claimType !== "institutional" || !b.claim.institutional) notFound();
  const i = b.claim.institutional;
  const total = b.lines.reduce((a, l) => a + l.chargeCents * l.units, 0);
  const [principal, ...others] = b.encounter.diagnoses;
  const procs = i.procedures ?? [];
  const insuredName = b.insurance.relationship === "self" ? `${b.patient.lastName}, ${b.patient.firstName}` : `${b.insurance.subscriberLastName ?? ""}, ${b.insurance.subscriberFirstName ?? ""}`;
  return (
    <main className="mx-auto max-w-4xl bg-white p-6 text-slate-900">
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <Link href={`/claims/${id}`} className="btn btn-secondary">Back to claim {b.claim.controlNumber}</Link>
        <PrintButton />
        <p className="text-xs text-slate-600">Plain-paper copy by form locator. It is not aligned to the red UB-04 form, so payers that scan paper claims will not accept it; send the 837I instead.</p>
      </div>
      <h1 className="mb-3 text-center text-sm font-bold tracking-wide">UB-04 (CMS-1450) · PLAIN-PAPER COPY · NOT FOR OCR</h1>

      <div className="grid grid-cols-4">
        <Box fl="1" label="Provider" className="col-span-2">{b.practice.name}<br />{b.practice.address1}<br />{b.practice.city}, {b.practice.state} {b.practice.zip}{b.practice.phone && <><br />{b.practice.phone}</>}</Box>
        <Box fl="3a" label="Patient control no.">{b.claim.controlNumber}</Box>
        <Box fl="4" label="Type of bill">{i.typeOfBill.padStart(4, "0")}</Box>
        <Box fl="5" label="Federal tax no.">{b.practice.taxId}</Box>
        <Box fl="6" label="Statement period">{mdy(i.statementFrom)} – {mdy(i.statementTo)}</Box>
        <Box fl="56" label="Billing NPI">{b.practice.npi}</Box>
        <Box fl="64" label="Document control no.">{b.claim.originalPayerClaimNumber ?? ""}</Box>
        <Box fl="8" label="Patient name" className="col-span-2">{b.patient.lastName}, {b.patient.firstName}</Box>
        <Box fl="9" label="Patient address" className="col-span-2">{b.patient.address1}, {b.patient.city}, {b.patient.state} {b.patient.zip}</Box>
        <Box fl="10" label="Birthdate">{mdy(b.patient.dob)}</Box>
        <Box fl="11" label="Sex">{b.patient.sex}</Box>
        <Box fl="12–13" label="Admission date, hour">{mdy(i.admissionDate)} {i.admissionHour ?? ""}</Box>
        <Box fl="14–15" label="Admission type, source">{i.admissionType ?? ""} {i.admissionSource ?? ""}</Box>
        <Box fl="17" label="Patient status">{i.patientStatus}</Box>
        <Box fl="63" label="Treatment authorization">{b.claim.authorizationNumber ?? ""}</Box>
      </div>

      <table className="mt-3 w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wide text-slate-600">
            <th className="border border-slate-400 px-2 py-1">42 Rev. cd.</th><th className="border border-slate-400 px-2 py-1">44 HCPCS / modifiers</th>
            <th className="border border-slate-400 px-2 py-1">45 Serv. date</th><th className="border border-slate-400 px-2 py-1 text-right">46 Units</th><th className="border border-slate-400 px-2 py-1 text-right">47 Total charges</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {b.lines.map((l) => (
            <tr key={l.id}>
              <td className="border border-slate-400 px-2 py-1">{(l.revenueCode ?? "").padStart(4, "0")}</td>
              <td className="border border-slate-400 px-2 py-1">{[l.cpt, ...l.modifiers].filter(Boolean).join(" ")}</td>
              <td className="border border-slate-400 px-2 py-1">{mdy(b.encounter.dateOfService)}</td>
              <td className="border border-slate-400 px-2 py-1 text-right">{l.units}</td>
              <td className="border border-slate-400 px-2 py-1 text-right">{money(l.chargeCents * l.units)}</td>
            </tr>
          ))}
          <tr className="font-semibold"><td className="border border-slate-400 px-2 py-1">0001</td><td className="border border-slate-400 px-2 py-1" colSpan={3}>Total</td><td className="border border-slate-400 px-2 py-1 text-right">{money(total)}</td></tr>
        </tbody>
      </table>

      <div className="mt-3 grid grid-cols-4">
        <Box fl="50" label="Payer" className="col-span-2">{b.payer.name}</Box>
        <Box fl="51" label="Health plan ID">{b.payer.payerId}</Box>
        <Box fl="59" label="Relationship">{RELATIONSHIP[b.insurance.relationship] ?? b.insurance.relationship}</Box>
        <Box fl="58" label="Insured name" className="col-span-2">{insuredName}</Box>
        <Box fl="60" label="Insured's unique ID">{b.insurance.memberId}</Box>
        <Box fl="62" label="Group no.">{b.insurance.groupNumber ?? ""}</Box>
        <Box fl="66" label="Dx version">0 (ICD-10)</Box>
        <Box fl="67" label="Principal diagnosis">{principal ? dx(principal) : ""}</Box>
        <Box fl="69" label="Admitting diagnosis">{i.admittingDiagnosis ? dx(i.admittingDiagnosis) : ""}</Box>
        <Box fl="67A–Q" label="Other diagnoses">{others.map(dx).join(" ")}</Box>
        <Box fl="74" label="Principal procedure, date" className="col-span-2">{procs[0] ? `${procs[0].code} ${mdy(procs[0].date)}` : ""}</Box>
        <Box fl="74a–e" label="Other procedures, dates" className="col-span-2">{procs.slice(1, 6).map((p) => `${p.code} ${mdy(p.date)}`).join(" · ")}</Box>
        <Box fl="76" label="Attending" className="col-span-2">NPI {b.provider.npi} · {b.provider.lastName}, {b.provider.firstName}</Box>
      </div>
      {procs.length > 6 && <p className="mt-2 text-xs text-slate-600">{procs.length - 6} more procedures are on the electronic claim; the UB-04 has room for six.</p>}
    </main>
  );
}
