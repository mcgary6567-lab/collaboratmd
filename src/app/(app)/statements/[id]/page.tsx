import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { getStatement } from "@/server/billing";
import { markStatementSentAction, voidStatementAction } from "@/app/(app)/billing-actions";
import { PrintButton } from "@/components/action-form";
import { Badge } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

/**
 * A patient statement laid out along HFMA's Patient Friendly Billing
 * principles: the amount due and its date first, an account summary in plain
 * words, each visit that makes up the balance, how insurance handled it, how
 * to pay, and where to turn if paying in full is not possible.
 */
export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const row = await getStatement(db, s.practiceId, id);
  if (!row) notFound();
  const { statement: st, patient, practice } = row;
  const visits = st.detail.visits;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/patients/${patient.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
          Back to {patient.firstName} {patient.lastName}
        </Link>
        <div className="flex items-center gap-2">
          <Badge tone={st.status === "sent" ? "green" : st.status === "void" ? "slate" : "blue"}>
            {st.status}{st.channel ? ` · ${st.channel}` : ""}
          </Badge>
          <PrintButton label="Print statement" />
          {st.status === "generated" && (
            <form action={markStatementSentAction.bind(null, st.id, "print")}>
              <button className="btn btn-primary">Mark as mailed</button>
            </form>
          )}
          {st.status !== "void" && (
            <form action={voidStatementAction.bind(null, st.id)}>
              <button className="btn btn-secondary">Void</button>
            </form>
          )}
        </div>
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-800">
        {/* header */}
        <header className="flex flex-wrap items-start justify-between gap-6 border-b border-slate-200 pb-6">
          <div>
            <div className="text-lg font-bold text-slate-900">{practice.name}</div>
            <div className="mt-1 text-slate-600">
              {practice.address1}<br />{practice.city}, {practice.state} {practice.zip}
              {practice.phone && <><br />{practice.phone}</>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Patient statement</div>
            <div className="mt-1 font-mono">{st.statementNumber}</div>
            <div className="mt-1 text-slate-600">Statement date {fmtDate(st.statementDate + "T00:00:00")}</div>
            <div className="text-slate-600">Account {patient.mrn}</div>
          </div>
        </header>

        {/* amount due first */}
        <section className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Statement for</div>
            <div className="mt-1 font-semibold text-slate-900">{patient.firstName} {patient.lastName}</div>
            <div className="text-slate-600">
              {patient.address1 && <>{patient.address1}<br /></>}
              {patient.city && `${patient.city}, ${patient.state} ${patient.zip}`}
            </div>
          </div>
          <div className="rounded-xl border-2 border-green-600 bg-green-50 p-5 text-center">
            <div className="text-xs font-bold uppercase tracking-widest text-green-800">Amount due</div>
            <div className="mt-1 text-3xl font-extrabold text-slate-900">{money(st.amountDueCents)}</div>
            <div className="mt-1 font-semibold text-green-800">Please pay by {fmtDate(st.dueDate + "T00:00:00")}</div>
          </div>
        </section>

        {/* summary in plain words */}
        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Account summary</h2>
          <dl className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {[
              ["Charges for your visits", st.chargesCents],
              ["Paid by your insurance", -st.insurancePaidCents || 0],
              ["Insurance adjustments and discounts", -st.adjustmentsCents || 0],
              ["Payments you have made", -st.patientPaidCents || 0],
            ].map(([label, cents]) => (
              <div key={label as string} className="flex justify-between px-4 py-2.5">
                <dt>{label}</dt>
                <dd className="tabular-nums">{(cents as number) < 0 ? `- ${money(-(cents as number))}` : money((cents as number) || 0)}</dd>
              </div>
            ))}
            <div className="flex justify-between bg-slate-50 px-4 py-2.5 font-bold text-slate-900">
              <dt>Your balance</dt>
              <dd className="tabular-nums">{money(st.amountDueCents)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-slate-600">
            Your insurance has already processed the visits below. The balance is your share under your
            plan, such as a deductible, copay or coinsurance.
          </p>
        </section>

        {/* visit detail */}
        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Visit detail</h2>
          <table className="mt-3 w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">Visit</th>
                <th className="py-2 pr-3">Services</th>
                <th className="py-2 pr-3 text-right">Charges</th>
                <th className="py-2 pr-3 text-right">Insurance paid</th>
                <th className="py-2 pr-3 text-right">Adjusted</th>
                <th className="py-2 text-right">You owe</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visits.map((v, i) => (
                <tr key={v.claimId ?? i} className="print-avoid-break align-top">
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {v.dateOfService ? fmtDate(v.dateOfService + "T00:00:00") : "-"}
                    {v.provider && <div className="text-xs text-slate-500">{v.provider}</div>}
                  </td>
                  <td className="py-2.5 pr-3">
                    {v.services.map((sv) => (
                      <div key={sv.cpt} className="text-slate-700">{sv.description}</div>
                    ))}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(v.chargesCents)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(v.insurancePaidCents)}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{money(v.adjustmentsCents)}</td>
                  <td className="py-2.5 text-right font-semibold tabular-nums">{money(v.youOweCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(st.detail.unappliedPaymentsCents > 0 || st.detail.discountsCents > 0) && (
            <p className="mt-2 text-xs text-slate-500">
              {st.detail.unappliedPaymentsCents > 0 && <>Payments on account of {money(st.detail.unappliedPaymentsCents)} have been applied. </>}
              {st.detail.discountsCents > 0 && <>Discounts of {money(st.detail.discountsCents)} have been applied.</>}
            </p>
          )}
        </section>

        {/* how to pay, and help */}
        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">How to pay</h2>
            <ul className="mt-2 space-y-1 text-slate-700">
              {practice.phone && <li>By phone: call {practice.phone} with your account number.</li>}
              <li>By mail: send a check payable to {practice.name} with the stub below.</li>
              <li>In person: at your next visit, at the front desk.</li>
            </ul>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">Need help paying?</h2>
            <p className="mt-2 text-slate-700">
              If you cannot pay the full amount, call us before the due date. We can set up a payment
              plan, and you may qualify for a financial hardship discount.
            </p>
          </div>
        </section>

        {/* remittance stub */}
        <section className="print-avoid-break mt-10 border-t-2 border-dashed border-slate-300 pt-6">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Please return this portion with your payment</div>
          <div className="mt-3 grid gap-4 sm:grid-cols-4">
            <div><div className="text-xs text-slate-500">Patient</div><div className="font-semibold">{patient.firstName} {patient.lastName}</div></div>
            <div><div className="text-xs text-slate-500">Account</div><div className="font-mono">{patient.mrn}</div></div>
            <div><div className="text-xs text-slate-500">Amount due</div><div className="font-semibold">{money(st.amountDueCents)}</div></div>
            <div><div className="text-xs text-slate-500">Amount enclosed</div><div className="mt-3 border-b border-slate-400" /></div>
          </div>
          <div className="mt-3 text-xs text-slate-500">Statement {st.statementNumber} · Due {fmtDate(st.dueDate + "T00:00:00")}</div>
        </section>
      </article>
    </div>
  );
}
