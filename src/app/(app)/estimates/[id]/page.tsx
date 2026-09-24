import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { getEstimate } from "@/server/billing";
import { GFE_DISPUTE_THRESHOLD_CENTS } from "@/lib/billing/estimate";
import { PrintButton } from "@/components/action-form";
import { fmtDate, fmtDateTime, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

type InsuredBasis = {
  payer?: string; planName?: string | null; benefitsCheckedAt?: string;
  copayCents?: number; deductibleRemainingCents?: number; coinsurancePct?: number; oopRemainingCents?: number | null;
  copayApplied?: number; deductibleApplied?: number; coinsuranceApplied?: number; oopCapApplied?: number;
  uncontractedCodes?: string[];
};
type SelfPayBasis = { selfPayDiscountPct?: number; discountCents?: number; policy?: string | null };

export default async function EstimatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const row = await getEstimate(db, s.practiceId, id);
  if (!row) notFound();
  const { estimate: e, patient, practice } = row;
  const gfe = e.kind === "good_faith";
  const ib = e.basis as InsuredBasis;
  const sb = e.basis as SelfPayBasis;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-6 flex items-center justify-between gap-3">
        <Link href={`/patients/${patient.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
          Back to {patient.firstName} {patient.lastName}
        </Link>
        <PrintButton label="Print estimate" />
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-800">
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <div className="text-lg font-bold text-slate-900">{practice.name}</div>
            <div className="mt-1 text-slate-600">
              {practice.address1}<br />{practice.city}, {practice.state} {practice.zip}
              {practice.phone && <><br />{practice.phone}</>}
            </div>
            <div className="mt-1 text-xs text-slate-500">NPI {practice.npi} · Tax ID {practice.taxId}</div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">
              {gfe ? "Good faith estimate" : "Patient cost estimate"}
            </div>
            <div className="mt-1 font-mono">{e.estimateNumber}</div>
            <div className="mt-1 text-slate-600">Issued {fmtDate(e.createdAt)}</div>
            {e.validUntil && <div className="text-slate-600">Valid until {fmtDate(e.validUntil + "T00:00:00")}</div>}
          </div>
        </header>

        <section className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Prepared for</div>
            <div className="mt-1 font-semibold text-slate-900">{patient.firstName} {patient.lastName}</div>
            <div className="text-slate-600">Date of birth {fmtDate(patient.dob + "T00:00:00")} · Account {patient.mrn}</div>
            {e.serviceDate && <div className="text-slate-600">Planned service date {fmtDate(e.serviceDate + "T00:00:00")}</div>}
            {!gfe && <div className="mt-2 text-slate-600">Coverage: {ib.payer}{ib.planName ? `, ${ib.planName}` : ""}</div>}
          </div>
          <div className="rounded-xl border-2 border-green-600 bg-green-50 p-5 text-center">
            <div className="text-xs font-bold uppercase tracking-widest text-green-800">Your estimated cost</div>
            <div className="mt-1 text-3xl font-extrabold text-slate-900">{money(e.patientOwesCents)}</div>
            {!gfe && <div className="mt-1 text-green-800">Insurance is expected to pay {money(e.insurancePaysCents)}</div>}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Planned services</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Code</th><th className="py-2 pr-3">Service</th><th className="py-2 pr-3 text-right">Units</th>
                <th className="py-2 pr-3 text-right">Charge</th>{!gfe && <th className="py-2 text-right">Plan allows</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {e.lines.map((l) => (
                <tr key={l.cpt}>
                  <td className="py-2 pr-3 font-mono">{l.cpt}</td>
                  <td className="py-2 pr-3">{l.description}</td>
                  <td className="py-2 pr-3 text-right">{l.units}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(l.chargeCents * l.units)}</td>
                  {!gfe && <td className="py-2 text-right tabular-nums">{money(l.allowedCents * l.units)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">How this was calculated</h2>
          <dl className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {gfe ? (
              <>
                <Row label="Total charges" value={money(e.totalChargeCents)} />
                <Row label={`${sb.policy ?? "Self-pay discount"} (${sb.selfPayDiscountPct ?? 0}%)`} value={`- ${money(sb.discountCents ?? 0)}`} />
                <Row label="Your estimated cost" value={money(e.patientOwesCents)} strong />
              </>
            ) : (
              <>
                <Row label="Amount your plan allows" value={money(e.allowedCents)} />
                <Row label="Office visit copay" value={money(ib.copayApplied ?? 0)} />
                <Row label={`Toward your deductible (${money(ib.deductibleRemainingCents ?? 0)} remaining before this visit)`} value={money(ib.deductibleApplied ?? 0)} />
                <Row label={`Coinsurance (${ib.coinsurancePct ?? 0}% of the rest)`} value={money(ib.coinsuranceApplied ?? 0)} />
                {(ib.oopCapApplied ?? 0) > 0 && <Row label="Reduced because you reach your out-of-pocket maximum" value={`- ${money(ib.oopCapApplied ?? 0)}`} />}
                <Row label="Your estimated cost" value={money(e.patientOwesCents)} strong />
              </>
            )}
          </dl>
          {!gfe && ib.benefitsCheckedAt && (
            <p className="mt-2 text-xs text-slate-500">Benefits verified with {ib.payer} on {fmtDateTime(ib.benefitsCheckedAt)}.</p>
          )}
          {!gfe && (ib.uncontractedCodes?.length ?? 0) > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              No contracted rate is on file for {ib.uncontractedCodes!.join(", ")}, so the full charge was used. The actual allowed amount is likely lower.
            </p>
          )}
        </section>

        <section className="mt-8 rounded-lg bg-slate-50 p-5 text-xs leading-relaxed text-slate-600">
          {gfe ? (
            <>
              <p className="font-semibold text-slate-800">Your right to a good faith estimate</p>
              <p className="mt-2">
                Under the No Surprises Act, if you are uninsured or not using insurance, you have the right to a good
                faith estimate of the expected charges for scheduled care. If you are billed {money(GFE_DISPUTE_THRESHOLD_CENTS)} or
                more above this estimate, you may be able to dispute the bill. Keep a copy of this estimate. For
                questions or to learn about the dispute process, visit www.cms.gov/nosurprises.
              </p>
              <p className="mt-2">
                This estimate covers only the services listed. Additional services recommended during your visit
                would be estimated separately.
              </p>
            </>
          ) : (
            <p>
              This is an estimate, not a guarantee of payment or of your final bill. What you owe is decided when your
              insurance processes the claim, and can change if your benefits, other visits this year, or the services
              you receive differ from those listed here.
            </p>
          )}
        </section>
      </article>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-6 px-4 py-2.5 ${strong ? "bg-slate-50 font-bold text-slate-900" : ""}`}>
      <dt>{label}</dt>
      <dd className="whitespace-nowrap tabular-nums">{value}</dd>
    </div>
  );
}
