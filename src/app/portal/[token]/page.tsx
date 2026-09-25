import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CreditCard, FileText, Receipt, ShieldCheck } from "lucide-react";
import { getDb } from "@/db";
import { LogoMark } from "@/components/logo";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { portalVerifiedFor } from "@/lib/portal-session";
import { openPortal, portalData } from "@/server/portal";
import { fmtDate, money } from "@/lib/utils";
import { payAction, reportInsuranceAction, verifyPortalAction } from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Your account", robots: { index: false, follow: false }, referrer: "same-origin" };

function Shell({ practice, children }: { practice?: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-5 text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Patient account</p>
          <h1 className="text-xl font-bold text-slate-900">{practice ?? "Your account"}</h1>
        </div>
        {children}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-slate-400"><LogoMark className="h-4 w-4" id="cmd-portal" /> Secured by CollaboratMD</p>
      </div>
    </main>
  );
}

export default async function PortalPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ paid?: string }> }) {
  const { token } = await params;
  const { paid } = await searchParams;
  const db = await getDb();
  const o = await openPortal(db, token);
  if (o.state === "invalid") return <Shell><div className="card p-6 text-sm">This link is not valid. It may have been replaced by a newer one; use the latest link from the office.</div></Shell>;
  if (o.state !== "open") {
    return (
      <Shell practice={o.practiceName}>
        <div className="card p-6 text-sm">
          {o.state === "locked" ? "For your security this link was locked after several unsuccessful attempts." : "This link has expired."} Please call the office{o.practicePhone ? ` at ${o.practicePhone}` : ""} for a new one.
        </div>
      </Shell>
    );
  }
  if (!(await portalVerifiedFor(o.link.id))) {
    return (
      <Shell practice={o.practiceName}>
        <div className="card mx-auto max-w-md p-6">
          <h2 className="mb-1 text-base font-semibold">Confirm it&apos;s you</h2>
          <p className="mb-4 text-sm text-slate-600">Enter the patient&apos;s date of birth to see the account.</p>
          <ActionForm action={verifyPortalAction.bind(null, token)} className="space-y-3">
            <input name="dob" type="date" className="input" required autoComplete="bday" aria-label="Date of birth" />
            <SubmitButton className="btn btn-primary w-full justify-center" pendingLabel="Checking...">Continue</SubmitButton>
          </ActionForm>
        </div>
      </Shell>
    );
  }

  const d = await portalData(db, o.link.id);
  if (!d) return <Shell practice={o.practiceName}><div className="card p-6 text-sm">This account could not be loaded. Please call the office.</div></Shell>;
  const plan = d.plans.find((p) => ["active", "defaulted"].includes(p.plan.status));
  const nextDue = plan?.installments.find((i) => i.status !== "paid");
  const card = d.cards[0];

  return (
    <Shell practice={d.practice.name}>
      {paid && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-900">
          Thank you. Your payment is being confirmed by the card processor and will show here within a minute.
        </div>
      )}
      <div className="card mb-4 p-6">
        <div className="text-sm text-slate-500">Hi {d.patient.firstName}. Your balance</div>
        <div className="mt-1 text-4xl font-extrabold tracking-tight">{money(Math.max(d.balance, 0))}</div>
        {d.balance < 0 && <p className="mt-1 text-sm text-green-700">You have a credit of {money(-d.balance)}.</p>}
        {plan && nextDue && (
          <p className="mt-2 text-sm text-slate-600">
            Payment plan: next installment {money(nextDue.amountCents - nextDue.paidCents)} due {fmtDate(nextDue.dueDate + "T00:00:00")}
            {card?.autopayPlanId === plan.plan.id && <> · paid automatically from {card.brand} ending {card.last4}</>}
          </p>
        )}
      </div>

      {d.balance > 0 && (
        <div className="card mb-4 p-6">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><CreditCard className="h-4 w-4" /> Make a payment</h2>
          {d.onlinePayments ? (
            <ActionForm action={payAction.bind(null, token)} className="space-y-3 text-sm">
              <label className="block">
                <span className="label">Amount ($)</span>
                <input name="amount" type="number" step="0.01" min="1" max={(Math.max(d.balance, 0) / 100).toFixed(2)} defaultValue={((nextDue ? nextDue.amountCents - nextDue.paidCents : d.balance) / 100).toFixed(2)} className="input max-w-xs" required />
              </label>
              {plan && (
                <>
                  <input type="hidden" name="planId" value={plan.plan.id} />
                  {card?.autopayPlanId !== plan.plan.id && (
                    <label className="flex items-start gap-2">
                      <input type="checkbox" name="autopay" className="mt-1" />
                      <span>Save this card and pay my plan installments automatically on their due dates. I can ask the office to stop this at any time.</span>
                    </label>
                  )}
                </>
              )}
              <SubmitButton className="btn btn-primary" pendingLabel="Opening secure payment...">Pay securely</SubmitButton>
              <p className="flex items-center gap-1 text-xs text-slate-500"><ShieldCheck className="h-3.5 w-3.5" /> You will pay on Stripe&apos;s secure page. Your card number is never sent to this site.</p>
            </ActionForm>
          ) : (
            <p className="text-sm text-slate-600">Online payment is not available yet. Please call the office{d.practice.phone ? ` at ${d.practice.phone}` : ""} to pay by phone, or pay at your next visit.</p>
          )}
        </div>
      )}

      {d.visits.length > 0 && (
        <div className="card mb-4 p-6">
          <h2 className="mb-3 font-semibold">What you owe for</h2>
          <ul className="divide-y divide-slate-200 text-sm">
            {d.visits.map((v, i) => (
              <li key={i} className="flex justify-between py-2">
                <span>Visit on {v.dateOfService ? fmtDate(v.dateOfService + "T00:00:00") : "unknown date"}{v.provider ? ` · ${v.provider}` : ""}</span>
                <span className="font-medium">{money(v.youOweCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-6">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><FileText className="h-4 w-4" /> Statements</h2>
          {d.statements.length === 0 ? <p className="text-sm text-slate-500">No statements yet.</p> : (
            <ul className="space-y-1 text-sm">
              {d.statements.map((s) => (
                <li key={s.id} className="flex justify-between">
                  <span>{fmtDate(s.createdAt)} · #{s.statementNumber}</span>
                  <span>{money(s.amountDueCents)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-6">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><Receipt className="h-4 w-4" /> Payments received</h2>
          {d.payments.length === 0 ? <p className="text-sm text-slate-500">No payments yet.</p> : (
            <ul className="space-y-1 text-sm">
              {d.payments.map((p) => (
                <li key={p.id} className="flex justify-between"><span>{fmtDate(p.postedAt)}</span><span>{money(p.amountCents)}</span></li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card mt-4 p-6">
        <h2 className="mb-1 font-semibold">New insurance?</h2>
        <p className="mb-3 text-sm text-slate-600">Tell us about a new insurance card and the office will update your account.</p>
        <ActionForm action={reportInsuranceAction.bind(null, token)} className="grid gap-2 text-sm sm:grid-cols-3">
          <input name="payerName" className="input" placeholder="Insurance company" required />
          <input name="memberId" className="input" placeholder="Member ID" required />
          <input name="groupNumber" className="input" placeholder="Group number (optional)" />
          <div className="sm:col-span-3"><SubmitButton className="btn btn-secondary" pendingLabel="Sending...">Send to the office</SubmitButton></div>
        </ActionForm>
      </div>
    </Shell>
  );
}
