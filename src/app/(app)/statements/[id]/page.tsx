import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { logPatientView } from "@/lib/log-view";
import { restrictedAccess } from "@/server/restricted";
import { RestrictedGate } from "@/components/restricted-gate";
import { getStatement } from "@/server/billing";
import { mailStatementAction, markStatementSentAction, voidStatementAction } from "@/app/(app)/billing-actions";
import { practiceConfig } from "@/server/integrations";
import { ActionForm, PrintButton, SubmitButton } from "@/components/action-form";
import { Badge } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";
import { langOf } from "@/lib/i18n/messages";
import { STATEMENT_TEXT, statementDay } from "@/lib/i18n/statement";

export const dynamic = "force-dynamic";

/**
 * A patient statement laid out along HFMA's Patient Friendly Billing
 * principles: the amount due and its date first, an account summary in plain
 * words, each visit that makes up the balance, how insurance handled it, how
 * to pay, and where to turn if paying in full is not possible. The statement
 * itself is in the patient's preferred language; the controls above it are not.
 */
export default async function StatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const row = await getStatement(db, s.practiceId, id);
  if (!row) notFound();
  const { statement: st, patient, practice } = row;
  const gate = await restrictedAccess(db, s, patient.id);
  if (!gate.granted) return <RestrictedGate patientId={patient.id} back={`/statements/${id}`} what="statement" />;
  await logPatientView(s, patient.id, "statement", st.id);
  const visits = st.detail.visits;
  const lob = !!(await practiceConfig(db, s.practiceId)).lob;
  const lang = langOf(patient.preferredLanguage);
  const t = STATEMENT_TEXT[lang];
  const day = (iso: string) => (lang === "es" ? statementDay("es", iso) : fmtDate(iso + "T00:00:00"));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/patients/${patient.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
          Back to {patient.firstName} {patient.lastName}
        </Link>
        <div className="flex items-center gap-2">
          {lang === "es" && <Badge tone="slate">Spanish</Badge>}
          <Badge tone={st.status === "sent" ? "green" : st.status === "void" ? "slate" : "blue"}>
            {st.status}{st.channel ? ` · ${st.channel}` : ""}
          </Badge>
          <PrintButton label="Print statement" />
          {st.mailId && <span className="text-xs text-slate-500">Lob {st.mailId}{st.mailStatus === "test" ? " (test, not mailed)" : ""}</span>}
          {st.status === "generated" && lob && (
            <ActionForm action={mailStatementAction.bind(null, st.id)}><SubmitButton pendingLabel="Sending to Lob...">Mail with Lob</SubmitButton></ActionForm>
          )}
          {st.status === "generated" && (
            <form action={markStatementSentAction.bind(null, st.id, "print")}>
              <button className={lob ? "btn btn-secondary" : "btn btn-primary"}>Mark as mailed</button>
            </form>
          )}
          {st.status !== "void" && (
            <form action={voidStatementAction.bind(null, st.id)}>
              <button className="btn btn-secondary">Void</button>
            </form>
          )}
        </div>
      </div>

      <article lang={lang} className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-800">
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
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.patientStatement}</div>
            <div className="mt-1 font-mono">{st.statementNumber}</div>
            <div className="mt-1 text-slate-600">{t.statementDate} {day(st.statementDate)}</div>
            <div className="text-slate-600">{t.account} {patient.mrn}</div>
          </div>
        </header>

        {/* amount due first */}
        <section className="mt-6 grid gap-6 sm:grid-cols-2">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.statementFor}</div>
            <div className="mt-1 font-semibold text-slate-900">{patient.firstName} {patient.lastName}</div>
            <div className="text-slate-600">
              {patient.address1 && <>{patient.address1}<br /></>}
              {patient.city && `${patient.city}, ${patient.state} ${patient.zip}`}
            </div>
          </div>
          <div className="rounded-xl border-2 border-green-600 bg-green-50 p-5 text-center">
            <div className="text-xs font-bold uppercase tracking-widest text-green-800">{t.amountDue}</div>
            <div className="mt-1 text-3xl font-extrabold text-slate-900">{money(st.amountDueCents)}</div>
            <div className="mt-1 font-semibold text-green-800">{t.payBy(day(st.dueDate))}</div>
          </div>
        </section>

        {/* summary in plain words */}
        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.summary}</h2>
          <dl className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {[
              [t.charges, st.chargesCents],
              [t.insurancePaid, -st.insurancePaidCents || 0],
              [t.adjustments, -st.adjustmentsCents || 0],
              [t.youPaid, -st.patientPaidCents || 0],
            ].map(([label, cents]) => (
              <div key={label as string} className="flex justify-between px-4 py-2.5">
                <dt>{label}</dt>
                <dd className="tabular-nums">{(cents as number) < 0 ? `- ${money(-(cents as number))}` : money((cents as number) || 0)}</dd>
              </div>
            ))}
            <div className="flex justify-between bg-slate-50 px-4 py-2.5 font-bold text-slate-900">
              <dt>{t.balance}</dt>
              <dd className="tabular-nums">{money(st.amountDueCents)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-slate-600">{t.processed}</p>
        </section>

        {/* visit detail */}
        <section className="mt-8">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.visitDetail}</h2>
          <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="mt-3 w-full text-left text-sm">
            <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-3">{t.visit}</th>
                <th className="py-2 pr-3">{t.services}</th>
                <th className="py-2 pr-3 text-right">{t.chargesCol}</th>
                <th className="py-2 pr-3 text-right">{t.insurancePaidCol}</th>
                <th className="py-2 pr-3 text-right">{t.adjustedCol}</th>
                <th className="py-2 text-right">{t.youOwe}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visits.map((v, i) => (
                <tr key={v.claimId ?? i} className="print-avoid-break align-top">
                  <td className="py-2.5 pr-3 whitespace-nowrap">
                    {v.dateOfService ? day(v.dateOfService) : "-"}
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
          </table></div>
          {(st.detail.unappliedPaymentsCents > 0 || st.detail.discountsCents > 0) && (
            <p className="mt-2 text-xs text-slate-500">
              {st.detail.unappliedPaymentsCents > 0 && t.unapplied(money(st.detail.unappliedPaymentsCents))}
              {st.detail.discountsCents > 0 && t.discounts(money(st.detail.discountsCents))}
            </p>
          )}
        </section>

        {/* how to pay, and help */}
        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.howToPay}</h2>
            <ul className="mt-2 space-y-1 text-slate-700">
              {practice.phone && <li>{t.byPhone(practice.phone)}</li>}
              <li>{t.byMail(practice.name)}</li>
              <li>{t.inPerson}</li>
            </ul>
          </div>
          <div>
            <h2 className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.needHelp}</h2>
            <p className="mt-2 text-slate-700">{t.help}</p>
          </div>
        </section>

        {/* remittance stub */}
        <section className="print-avoid-break mt-10 border-t-2 border-dashed border-slate-300 pt-6">
          <div className="text-xs font-bold uppercase tracking-widest text-slate-500">{t.returnStub}</div>
          <div className="mt-3 grid gap-4 sm:grid-cols-4">
            <div><div className="text-xs text-slate-500">{t.patient}</div><div className="font-semibold">{patient.firstName} {patient.lastName}</div></div>
            <div><div className="text-xs text-slate-500">{t.account}</div><div className="font-mono">{patient.mrn}</div></div>
            <div><div className="text-xs text-slate-500">{t.amountDue}</div><div className="font-semibold">{money(st.amountDueCents)}</div></div>
            <div><div className="text-xs text-slate-500">{t.enclosed}</div><div className="mt-3 border-b border-slate-400" /></div>
          </div>
          <div className="mt-3 text-xs text-slate-500">{t.statement} {st.statementNumber} · {t.due(day(st.dueDate))}</div>
        </section>
      </article>
    </div>
  );
}
