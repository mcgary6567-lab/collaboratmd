import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireRole } from "@/lib/auth";
import { TIERS } from "@/content/pricing";
import { listInvoices, platformBillingReady, priceFor, standing } from "@/server/subscription";
import { billingPortalAction, subscribeAction } from "@/app/(app)/subscription-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Alert, Badge, Card, Money, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Subscription" };

export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  trialing: "Free trial", trial_ended: "Trial ended", active: "Active", past_due: "Payment past due", canceled: "Cancelled",
  unpaid: "Unpaid", incomplete: "Payment incomplete", incomplete_expired: "Checkout expired", paused: "Paused", none: "Not on a self-serve plan",
};

export default async function SubscriptionPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const sp = await searchParams;
  const s = await requireRole(["admin"]);
  const db = await getDb();
  const [[p], invoices] = await Promise.all([db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1), listInvoices(db, s.practiceId)]);
  const st = standing(p);
  const ready = platformBillingReady();
  const buyable = TIERS.filter((t) => priceFor(t.id, "monthly") || priceFor(t.id, "annual"));
  const tier = TIERS.find((t) => t.id === p.plan);
  const subscribed = !!p.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(p.subscriptionStatus);

  return (
    <>
      <PageHeader title="Subscription" subtitle="Your practice's plan for CollaboratMD itself" actions={<Link href="/pricing" className="btn btn-secondary">Compare plans</Link>} />
      {sp.done && <Alert kind="success">Thank you. Stripe is confirming the subscription; this page updates within a minute.</Alert>}
      {st.blocked && <Alert kind="error">{st.reason}</Alert>}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Current plan" actions={<Badge tone={st.blocked ? "red" : subscribed ? "green" : "amber"}>{LABEL[st.status] ?? st.status}</Badge>}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Plan</dt><dd className="font-semibold">{tier?.name ?? "Not chosen"}</dd></div>
            {st.trialDaysLeft !== null && <div className="flex justify-between"><dt className="text-slate-500">Trial</dt><dd>{st.trialDaysLeft} day{st.trialDaysLeft === 1 ? "" : "s"} left{p.trialEndsAt ? `, ends ${fmtDate(p.trialEndsAt)}` : ""}</dd></div>}
            {p.seats !== null && <div className="flex justify-between"><dt className="text-slate-500">Providers billed</dt><dd>{p.seats} (follows your active providers, checked daily)</dd></div>}
            {p.currentPeriodEnd && <div className="flex justify-between"><dt className="text-slate-500">Renews</dt><dd>{fmtDate(p.currentPeriodEnd)}</dd></div>}
          </dl>
          {subscribed && ready && (
            <ActionForm action={billingPortalAction} className="mt-4"><SubmitButton className="btn btn-secondary" pendingLabel="Opening...">Manage billing, invoices and cancellation</SubmitButton></ActionForm>
          )}
          {!p.selfServe && <p className="mt-4 text-sm text-slate-600">This practice is billed under an agreement with CollaboratMD rather than a self-serve plan. Contact us about changes.</p>}
        </Card>
        {p.selfServe && !subscribed && (
          <Card title="Subscribe">
            {!ready || buyable.length === 0 ? (
              <p className="text-sm text-slate-600">Online checkout is not set up on this deployment yet. <Link href="/contact" className="font-semibold text-brand-700 hover:underline">Contact us</Link> to subscribe.</p>
            ) : (
              <ActionForm action={subscribeAction} className="space-y-3 text-sm">
                <fieldset className="space-y-2">
                  <legend className="label">Plan</legend>
                  {buyable.map((t) => (
                    <label key={t.id} className="flex items-start gap-2">
                      <input type="radio" name="plan" value={t.id} defaultChecked={t.id === (p.plan ?? buyable[0].id)} className="mt-1" />
                      <span><b>{t.name}</b>, ${t.priceMonthly} per provider per month{t.perClaimCents ? `, plus ${t.perClaimCents} cents per claim` : ""}<span className="block text-xs text-slate-500">{t.forWho}</span></span>
                    </label>
                  ))}
                </fieldset>
                <fieldset className="flex gap-4">
                  <legend className="label">Billing</legend>
                  <label className="flex items-center gap-2"><input type="radio" name="cycle" value="monthly" defaultChecked /> Monthly</label>
                  <label className="flex items-center gap-2"><input type="radio" name="cycle" value="annual" /> Annual</label>
                </fieldset>
                <SubmitButton pendingLabel="Opening checkout...">Continue to secure checkout</SubmitButton>
                <p className="text-xs text-slate-500">Checkout is on Stripe. You are billed for each active provider; the count updates as you add or deactivate providers.</p>
              </ActionForm>
            )}
          </Card>
        )}
      </div>
      {invoices.length > 0 && (
        <div className="mt-6">
          <Card title="Invoices">
            <div tabIndex={0} role="region" aria-label="Invoices" className="overflow-x-auto">
              <table className="table table-stack">
                <thead><tr><th>Invoice</th><th>Date</th><th>Period</th><th className="text-right">Amount</th><th>Status</th><th /></tr></thead>
                <tbody>{invoices.map((i) => (
                  <tr key={i.id}>
                    <td data-label="Invoice" className="font-mono text-xs">{i.number ?? "Draft"}</td>
                    <td data-label="Date">{fmtDate(i.createdAt, s.timeZone)}</td>
                    <td data-label="Period" className="text-xs">{i.periodStart && i.periodEnd ? `${fmtDate(i.periodStart, s.timeZone)} to ${fmtDate(i.periodEnd, s.timeZone)}` : ""}</td>
                    <td data-label="Amount" className="text-right"><Money cents={i.amountDueCents} /></td>
                    <td data-label="Status"><Badge tone={i.status === "paid" ? "green" : i.status === "payment_failed" || i.status === "uncollectible" ? "red" : "slate"}>{INVOICE_LABEL[i.status] ?? i.status}</Badge></td>
                    <td data-label="" className="text-right text-xs">
                      {i.hostedUrl && <a href={i.hostedUrl} target="_blank" rel="noreferrer noopener" className="font-semibold text-brand-700 hover:underline">{i.status === "paid" ? "Receipt" : "Pay or view"}</a>}
                      {i.pdfUrl && <> · <a href={i.pdfUrl} target="_blank" rel="noreferrer noopener" className="font-semibold text-brand-700 hover:underline">PDF</a></>}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

const INVOICE_LABEL: Record<string, string> = { draft: "Draft", open: "Due", paid: "Paid", payment_failed: "Payment failed", void: "Voided", uncollectible: "Uncollectible" };
