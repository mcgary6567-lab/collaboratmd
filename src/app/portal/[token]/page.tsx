import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CreditCard, FileText, Receipt, ShieldCheck } from "lucide-react";
import { getDb } from "@/db";
import { LogoMark } from "@/components/logo";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { portalVerifiedFor } from "@/lib/portal-session";
import { openPortal, portalData } from "@/server/portal";
import { money } from "@/lib/utils";
import { patientText } from "@/lib/i18n/patient-server";
import { formatDate, type Lang, type PatientText } from "@/lib/i18n/patient";
import { setPatientLangAction } from "@/app/lang-actions";
import { payAction, reportInsuranceAction, verifyPortalAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false }, referrer: "same-origin" };

function Shell({ practice, children, t, lang, path }: { practice?: string; children: ReactNode; t: PatientText; lang: Lang; path: string }) {
  return (
    <main lang={lang} className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <form action={setPatientLangAction.bind(null, lang === "es" ? "en" : "es", path)} className="mb-2 text-right">
          <button className="text-xs font-semibold text-brand-700 underline">{t.switchTo}</button>
        </form>
        <div className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{t.portalEyebrow}</p>
          <h1 className="text-xl font-bold text-slate-900">{practice ?? t.yourAccount}</h1>
        </div>
        {children}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400"><LogoMark className="h-4 w-4" id="cmd-portal" /> {t.securedBy}</p>
      </div>
    </main>
  );
}

export default async function PortalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token } = await params;
  const { paid } = await searchParams;
  const { lang, t } = await patientText();
  const path = `/portal/${token}`;
  const shell = { t, lang, path };
  const date = (d: Date | string) => formatDate(lang, d);
  const db = await getDb();
  const o = await openPortal(db, token);
  if (o.state === "invalid") return <Shell {...shell}><div className="card p-6 text-sm">{t.portalInvalid}</div></Shell>;
  if (o.state !== "open") {
    return (
      <Shell practice={o.practiceName} {...shell}>
        <div className="card p-6 text-sm">
          {o.state === "locked" ? t.portalLocked : t.portalExpired} {t.callForNew(o.practicePhone)}
        </div>
      </Shell>
    );
  }
  if (!(await portalVerifiedFor(o.link.id))) {
    return (
      <Shell practice={o.practiceName} {...shell}>
        <div className="card mx-auto max-w-md p-6">
          <h2 className="mb-1 text-base font-semibold">{t.confirmTitle}</h2>
          <p className="mb-4 text-sm text-slate-600">{t.portalConfirm}</p>
          <ActionForm action={verifyPortalAction.bind(null, token)} className="space-y-3">
            <input name="dob" type="date" className="input" required autoComplete="bday" aria-label={t.dob} />
            <SubmitButton className="btn btn-primary w-full justify-center" pendingLabel={t.checking}>{t.continue}</SubmitButton>
          </ActionForm>
        </div>
      </Shell>
    );
  }

  const d = await portalData(db, o.link.id);
  if (!d) return <Shell practice={o.practiceName} {...shell}><div className="card p-6 text-sm">{t.portalNotLoaded}</div></Shell>;
  const plan = d.plans.find((p) => ["active", "defaulted"].includes(p.plan.status));
  const nextDue = plan?.installments.find((i) => i.status !== "paid");
  const card = d.cards[0];

  return (
    <Shell practice={d.practice.name} {...shell}>
      {paid && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">{t.paymentConfirming}</div>}
      <div className="card mb-4 p-6">
        <div className="text-sm text-slate-500">{t.yourBalance(d.patient.firstName)}</div>
        <div className="mt-1 text-4xl font-extrabold tracking-tight">{money(Math.max(d.balance, 0))}</div>
        {d.balance < 0 && <p className="mt-1 text-sm text-green-700">{t.credit(money(-d.balance))}</p>}
        {plan && nextDue && (
          <p className="mt-2 text-sm text-slate-600">
            {t.planNext(money(nextDue.amountCents - nextDue.paidCents), date(nextDue.dueDate + "T00:00:00"))}
            {card?.autopayPlanId === plan.plan.id && t.autopayFrom(card.brand ?? "", card.last4 ?? "")}
          </p>
        )}
      </div>

      {d.depositDue > 0 && d.deposits[0] && (
        <div className="card mb-4 border-brand-200 p-6">
          <h2 className="mb-2 font-semibold">{t.depositTitle}</h2>
          <p className="text-sm text-slate-600">{t.depositFor(money(d.depositDue), date(d.deposits[0].startsAt))}</p>
        </div>
      )}

      {(d.balance > 0 || d.depositDue > 0) && (
        <div className="card mb-4 p-6">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4" /> {t.makePayment}</h2>
          {d.onlinePayments ? (
            <ActionForm action={payAction.bind(null, token)} className="space-y-3 text-sm">
              <label className="block">
                <span className="label">{t.amount}</span>
                <input name="amount" type="number" step="0.01" min="1" max={((Math.max(d.balance, 0) + d.depositDue) / 100).toFixed(2)} defaultValue={((nextDue ? nextDue.amountCents - nextDue.paidCents : Math.max(d.balance, 0) || d.depositDue) / 100).toFixed(2)} className="input max-w-xs" required />
              </label>
              {plan && (
                <>
                  <input type="hidden" name="planId" value={plan.plan.id} />
                  {card?.autopayPlanId !== plan.plan.id && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="autopay" className="mt-1" />
                      <span>{t.autopayOptIn}</span>
                    </label>
                  )}
                </>
              )}
              <SubmitButton className="btn btn-primary" pendingLabel={t.openingPayment}>{t.paySecurely}</SubmitButton>
              <p className="flex items-center gap-1 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> {t.stripeNote}</p>
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-600">{t.noOnlinePay(d.practice.phone)}</p>
          )}
        </div>
      )}

      {d.financing && (
        <div className="card mb-4 p-6">
          <h2 className="mb-2 font-semibold">{t.financingTitle}</h2>
          <p className="text-sm text-slate-600">{t.financingBody(d.financing.lender)}</p>
          <a href={d.financing.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary mt-3">{t.financingLink}</a>
        </div>
      )}

      {d.visits.length > 0 && (
        <div className="card mb-4 p-6">
          <h2 className="mb-3 font-semibold">{t.owedFor}</h2>
          <ul className="divide-y divide-slate-200 text-sm">
            {d.visits.map((v, i) => (
              <li key={i} className="flex justify-between py-2">
                <span>{t.visitOn(v.dateOfService ? date(v.dateOfService + "T00:00:00") : t.unknownDate)}{v.provider ? ` · ${v.provider}` : ""}</span>
                <span className="font-medium">{money(v.youOweCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" /> {t.statements}</h2>
          {d.statements.length === 0 ? <p className="text-sm text-slate-500">{t.noStatements}</p> : (
            <ul className="space-y-1 text-sm">
              {d.statements.map((s) => (
                <li key={s.id} className="flex justify-between">
                  <span>{date(s.createdAt)} · #{s.statementNumber}</span>
                  <span>{money(s.amountDueCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-6">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Receipt className="h-4 w-4" /> {t.paymentsReceived}</h2>
          {d.payments.length === 0 ? <p className="text-sm text-slate-500">{t.noPayments}</p> : (
            <ul className="space-y-1 text-sm">
              {d.payments.map((p) => (
                <li key={p.id} className="flex justify-between"><span>{date(p.postedAt)}</span><span>{money(p.amountCents)}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card mt-4 p-6">
        <h2 className="mb-1 font-semibold">{t.newInsurance}</h2>
        <p className="mb-3 text-sm text-slate-600">{t.newInsuranceHelp}</p>
        <ActionForm action={reportInsuranceAction.bind(null, token)} className="grid gap-2 text-sm sm:grid-cols-3">
          <input name="payerName" className="input" placeholder={t.insCompany} required />
          <input name="memberId" className="input" placeholder={t.memberId} required />
          <input name="groupNumber" className="input" placeholder={t.groupOptional} />
          <div className="sm:col-span-3"><SubmitButton className="btn btn-secondary" pendingLabel={t.sending}>{t.sendToOffice}</SubmitButton></div>
        </ActionForm>
      </div>
    </Shell>
  );
}
