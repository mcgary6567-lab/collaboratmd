import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { accessAnomalies, accessLimits, chartsOpenedBy, flagReviews, LIMIT_RANGES, LIMITS, type AccessLimits } from "@/server/access-anomalies";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { reviewFlagAction, saveAccessLimitsAction } from "../../access-review-actions";

export const metadata: Metadata = { title: "Access review" };

export const dynamic = "force-dynamic";

/** Who opened how many charts in the last day, against their usual; the practice's limits; and what reviewers found. Administrators only. */
export default async function AccessReviewPage({ searchParams }: { searchParams: Promise<{ user?: string }> }) {
  const { user } = await searchParams;
  const s = await requireRole(["admin"]);
  const db = await getDb();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const limits = await accessLimits(db, s.practiceId);
  const [people, reviews] = await Promise.all([accessAnomalies(db, s.practiceId, now, limits), flagReviews(db, s.practiceId, 90, now)]);
  const chosen = user && /^[0-9a-f-]{36}$/i.test(user) ? people.find((p) => p.userId === user) : undefined;
  const charts = chosen ? await chartsOpenedBy(db, s.practiceId, chosen.userId) : [];
  const reviewedToday = new Map(reviews.filter((r) => r.day === today).map((r) => [r.userId, r]));
  const custom = (Object.keys(LIMITS) as (keyof AccessLimits)[]).some((k) => limits[k] !== LIMITS[k]);
  return (
    <>
      <PageHeader title="Chart access review" subtitle="Charts each person opened in the last 24 hours, against their usual. Flags are prompts to look, not findings." actions={<Link href="/settings" className="btn btn-secondary">Back to settings</Link>} />
      <Card title="Last 24 hours">
        <p className="mb-3 text-xs text-slate-500">
          Flagged when someone opens {limits.chartsPerDay} or more charts in a day, or at least {limits.minForMultiple} and more than {limits.multiple} times their usual, or {limits.unrelatedPerDay} or more charts of patients with no appointment within 30 days, no claim or payment in six months, and not new. Administrators get a notification for each flag. Busy days (a payer audit, a statement run) will flag honest work; ask before assuming, and record what you found.
        </p>
        {people.length === 0 ? <Empty>No charts opened in the last 24 hours.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto">
            <table className="table text-sm">
              <thead><tr><th>Person</th><th className="text-right">Charts</th><th className="text-right">Usual a day</th><th className="text-right">No current business</th><th>Flag</th><th /></tr></thead>
              <tbody>
                {people.map((p) => {
                  const review = reviewedToday.get(p.userId);
                  return (
                    <tr key={p.userId}>
                      <td>{p.name}</td>
                      <td className="text-right tabular-nums">{p.charts}</td>
                      <td className="text-right tabular-nums">{p.usualPerDay}</td>
                      <td className="text-right tabular-nums">{p.unrelated}</td>
                      <td>
                        {p.flagged ? <Badge tone="amber">{p.why.join("; ")}</Badge> : <span className="text-slate-500">none</span>}
                        {review && <div className="mt-1 text-xs text-slate-600">Reviewed by {review.reviewer}: {review.note}</div>}
                      </td>
                      <td><Link href={`/settings/access-review?user=${p.userId}`} className="text-brand-700 hover:underline">{p.flagged && !review ? "Review" : "Charts"}</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {chosen && (
        <Card title={`Charts ${chosen.name} opened in the last 24 hours`} className="mt-6">
          {charts.length === 0 ? <Empty>None.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {charts.map((c) => (
                <li key={c.patientId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <span><Link href={`/patients/${c.patientId}/access`} className="font-medium text-brand-700 hover:underline">{c.name}</Link> <span className="text-slate-500">· MRN {c.mrn}</span></span>
                  <span className="text-xs text-slate-500">{c.times} time{c.times === 1 ? "" : "s"}, last {fmtDateTime(c.lastAt, s.timeZone)}</span>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={reviewFlagAction.bind(null, chosen.userId)} className="mt-4 space-y-2 border-t border-slate-200 pt-4">
            <label className="block text-sm">
              <span className="label">What you found</span>
              <textarea name="note" rows={2} className="textarea" required minLength={5} maxLength={1000} placeholder="Asked them: covering the front desk for the payer audit. Fine." />
            </label>
            <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Record the review</SubmitButton>
            <p className="text-xs text-slate-500">Kept in the audit log with your name and today&apos;s flag.</p>
          </ActionForm>
        </Card>
      )}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Limits">
          <p className="mb-3 text-xs text-slate-500">Set these to what is normal for your staff{custom ? " (these are your practice's own)" : " (these are the defaults)"}. A limit set too low flags every busy morning and gets ignored; too high and nothing is ever flagged.</p>
          <ActionForm action={saveAccessLimitsAction} className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(LIMITS) as (keyof AccessLimits)[]).map((k) => (
              <label key={k} className="block text-sm">
                <span className="label">{LIMIT_RANGES[k].label}</span>
                <input name={k} type="number" className="input" defaultValue={limits[k]} min={LIMIT_RANGES[k].min} max={LIMIT_RANGES[k].max} step={k === "multiple" ? 0.5 : 1} required />
              </label>
            ))}
            <div className="sm:col-span-2"><SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Save limits</SubmitButton></div>
          </ActionForm>
        </Card>
        <Card title="Reviews in the last 90 days">
          {reviews.length === 0 ? <Empty>No reviews recorded yet.</Empty> : (
            <ul className="divide-y divide-slate-100 text-sm">
              {reviews.map((r) => (
                <li key={`${r.at.toISOString()}-${r.userId}`} className="py-2">
                  <div className="font-medium">{r.person} · {r.day}</div>
                  {r.why.length > 0 && <div className="text-xs text-slate-500">{r.why.join("; ")}</div>}
                  <div className="text-slate-700">{r.note}</div>
                  <div className="text-xs text-slate-500">Reviewed by {r.reviewer}, {fmtDateTime(r.at, s.timeZone)}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
