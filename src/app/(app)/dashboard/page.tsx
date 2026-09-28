import type { Metadata } from "next";
import Link from "next/link";
import type { ComponentType, ReactNode } from "react";
import {
  AlarmClock, ArrowRight, CalendarDays, ChartColumn, CircleCheck, Gavel, Landmark, ListChecks, Plus, Send, ShieldAlert, Stethoscope, Timer, TriangleAlert, Wallet,
} from "lucide-react";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { userWorkload, recentPayments, recoveredDenials, collectionsSummary } from "@/server/analytics";
import { memo } from "@/lib/memo";
import { dataStamp } from "@/server/data-stamp";
import { listAppointments } from "@/server/encounters";
import { Badge } from "@/components/ui";
import { practiceNow } from "@/server/practice-time";
import { FeatureTips } from "./tips";
import { OnboardingGuide } from "./onboarding";
import { compactMoney, pct } from "@/components/kpi";
import { cn, fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Dashboard" };

export const dynamic = "force-dynamic";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;

/** Icon tints; each has a dark-mode counterpart in globals.css. */
const TINT = {
  amber: "bg-amber-50 text-amber-700",
  sky: "bg-sky-50 text-sky-700",
  rose: "bg-rose-50 text-rose-700",
  red: "bg-red-50 text-red-700",
  green: "bg-green-50 text-green-700",
  blue: "bg-blue-50 text-blue-700",
  teal: "bg-teal-50 text-teal-700",
} as const;

function IconBox({ icon: I, tint, muted, size = "md" }: { icon: Icon; tint: keyof typeof TINT; muted?: boolean; size?: "md" | "lg" }) {
  return (
    <span className={cn("flex shrink-0 items-center justify-center", size === "lg" ? "h-11 w-11 rounded-xl" : "h-9 w-9 rounded-lg", muted ? "bg-slate-100 text-slate-500" : TINT[tint])}>
      <I className={size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]"} aria-hidden />
    </span>
  );
}

/** One queue of work: how many, what it means, and where to go. At zero it says so and steps back. */
function WorkTile({ href, icon, tint, label, count, detail, action }: { href: string; icon: Icon; tint: keyof typeof TINT; label: string; count: number; detail: string; action: string }) {
  const clear = count === 0;
  return (
    <Link href={href} className="card group flex min-w-0 flex-col p-4 transition hover:border-slate-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
      <div className="flex items-start justify-between gap-3">
        <IconBox icon={icon} tint={tint} muted={clear} />
        <span className={cn("text-2xl font-bold leading-none tabular-nums", clear ? "text-slate-500" : "text-slate-900")}>{count.toLocaleString()}</span>
      </div>
      <div className="mt-3 text-sm font-semibold text-slate-900">{label}</div>
      <div className="mt-0.5 flex-1 text-xs text-slate-500">{detail}</div>
      <div className={cn("mt-3 flex items-center gap-1 text-xs font-semibold", clear ? "text-green-700" : "text-slate-700")}>
        {clear ? <><CircleCheck className="h-3.5 w-3.5" aria-hidden /> All clear</> : <>{action} <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" aria-hidden /></>}
      </div>
    </Link>
  );
}

function Panel({ icon: I, title, action, children, className }: { icon: Icon; title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("card min-w-0 p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><I className="h-4 w-4 text-slate-500" aria-hidden />{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const initials = (name: string) => name.split(/\s+/).filter((w) => /^[A-Za-z]/.test(w)).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

const STATUS: Record<string, { label: string; tone: "blue" | "green" | "red" | "slate" | "amber" }> = {
  scheduled: { label: "Scheduled", tone: "blue" },
  checked_in: { label: "Checked in", tone: "amber" },
  completed: { label: "Done", tone: "green" },
  no_show: { label: "No-show", tone: "red" },
  cancelled: { label: "Cancelled", tone: "slate" },
};

export default async function UserDashboard() {
  const s = await requireSession();
  const db = await getDb();
  const clock = await practiceNow(db, s.practiceId);

  const [work, payments, recovered, today, money] = await Promise.all([
    userWorkload(db, s.practiceId, s.userId),
    recentPayments(db, s.practiceId),
    recoveredDenials(db, s.practiceId),
    listAppointments(db, s.practiceId, clock),
    // Totals over months of ledger entries: cached, but recomputed as soon as anything is posted.
    dataStamp(db, s.practiceId).then((v) => memo(`collections:${s.practiceId}:${v}`, 5 * 60_000, () => collectionsSummary(db, s.practiceId))),
  ]);

  const firstName = s.name.split(" ")[0];
  // The practice's clock: appointment times and "today" are clock times (server/practice-time.ts).
  const hour = clock.getUTCHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateLabel = clock.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const waiting = [work.needsAttention, work.readyToSubmit, work.assignedOpen, work.dueSoon, work.overdueAppeals, work.checkedIn].filter((n) => n > 0).length;
  const rate = money.charges30 > 0 ? money.last30 / money.charges30 : 0;

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{dateLabel}</p>
          <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{greeting}, {firstName}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {waiting === 0 ? "Everything is up to date." : `${waiting} ${waiting === 1 ? "queue needs" : "queues need"} you today.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.role === "admin" && <Link href="/admin" className="btn btn-secondary"><ChartColumn className="h-4 w-4" aria-hidden /> Practice analytics</Link>}
          {work.readyToSubmit > 0 && <Link href="/claims?status=ready" className="btn btn-secondary"><Send className="h-4 w-4" aria-hidden /> Submit {work.readyToSubmit} ready</Link>}
          <Link href="/encounters/new" className="btn btn-primary"><Plus className="h-4 w-4" aria-hidden /> New charge</Link>
        </div>
      </header>

      {s.role === "admin" && <OnboardingGuide practiceId={s.practiceId} />}
      {s.role === "admin" && <FeatureTips practiceId={s.practiceId} />}

      <section aria-labelledby="needs-you">
        <h2 id="needs-you" className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900"><ListChecks className="h-4 w-4 text-slate-500" aria-hidden />Needs you</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          <WorkTile href="/claims?status=scrub_errors" icon={TriangleAlert} tint="amber" label="Claims to fix" count={work.needsAttention} detail={`${pct(work.needsAttentionShare, 1)} of all claims · aim under 1%`} action="Fix claims" />
          <WorkTile href="/claims?status=ready" icon={Send} tint="sky" label="Ready to submit" count={work.readyToSubmit} detail={work.readyToSubmit ? `Passed scrubbing · oldest ${work.readyOldestDays}d` : "Passed scrubbing, ready to bill"} action="Submit claims" />
          <WorkTile href="/denials?status=open" icon={ShieldAlert} tint="rose" label="Your denials" count={work.assignedOpen} detail={`${compactMoney(work.assignedOpenCents)} to recover · ${work.resolved30} closed in 30d`} action="Work denials" />
          <WorkTile href="/denials?status=open" icon={Timer} tint="amber" label="Appeals due soon" count={work.dueSoon} detail={`Within 14 days · ${pct(work.dueSoonShare, 0)} of your queue`} action="Appeal now" />
          <WorkTile href="/denials?status=open" icon={AlarmClock} tint="red" label="Appeals overdue" count={work.overdueAppeals} detail="Past the payer's deadline" action="Review" />
          <WorkTile href="/scheduling" icon={Stethoscope} tint="teal" label="Visits to charge" count={work.checkedIn} detail="Checked in, charges not entered" action="Enter charges" />
        </div>
      </section>

      <section className="card mt-6 p-5" aria-labelledby="collected">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <IconBox icon={Wallet} tint="green" size="lg" />
            <div>
              <h2 id="collected" className="text-sm font-medium text-slate-500">Collected, last 30 days</h2>
              <div className="text-3xl font-bold tracking-tight tabular-nums text-slate-900">{compactMoney(money.last30)}</div>
            </div>
          </div>
          <Link href="/remittance" className="btn btn-secondary text-sm"><Landmark className="h-4 w-4" aria-hidden /> Post remittances</Link>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-600">
            <span>{pct(rate, 0)} of the {compactMoney(money.charges30)} billed in the same 30 days</span>
            <span>{money.postedCount30.toLocaleString()} payments posted</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className="h-full rounded-full bg-green-600" style={{ width: `${Math.min(100, Math.round(rate * 100))}%` }} />
          </div>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-slate-200 pt-4 sm:grid-cols-5">
          {[
            { label: "Today", value: compactMoney(money.today) },
            { label: "Last 7 days", value: compactMoney(money.last7) },
            { label: "Last 12 months", value: compactMoney(money.last365) },
            { label: "Best month", value: money.bestMonth ? compactMoney(money.bestMonth.amount) : "-", sub: money.bestMonth?.month },
            { label: "Won on appeal, 90 days", value: compactMoney(recovered.amountCents), sub: `${recovered.count} ${recovered.count === 1 ? "denial" : "denials"}` },
          ].map((m) => (
            <div key={m.label}>
              <dt className="text-xs text-slate-500">{m.label}</dt>
              <dd className="mt-0.5 text-lg font-semibold tabular-nums text-slate-900">{m.value}{m.sub && <span className="ml-1.5 text-xs font-normal text-slate-500">{m.sub}</span>}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <Panel
          icon={Landmark}
          title="Payments just posted"
          className="lg:col-span-3"
          action={<Link href="/remittance" className="text-xs font-semibold text-brand-700 hover:underline">All remittances</Link>}
        >
          {payments.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No payments posted yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600" aria-hidden>{initials(p.payer)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-900">{p.patient}</div>
                    <div className="truncate text-xs text-slate-500">
                      {p.payer} · <Link href={`/claims/${p.claimId}`} className="font-mono text-brand-700 hover:underline">{p.controlNumber}</Link>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-sm font-semibold tabular-nums text-green-700">+{compactMoney(p.amountCents)}</div>
                    <div className="text-xs text-slate-500"><span className="hidden capitalize sm:inline">{p.source} · </span>{fmtDate(p.postedAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Panel
            icon={CalendarDays}
            title={`Today's schedule (${today.length})`}
            action={<Link href="/scheduling" className="text-xs font-semibold text-brand-700 hover:underline">Open schedule</Link>}
          >
            {today.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">Nothing booked today.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {today.slice(0, 8).map(({ appt, patient, provider }) => (
                  <li key={appt.id} className="flex items-center gap-3 py-2.5">
                    <span className="w-16 shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                      {appt.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link href={`/patients/${patient.id}`} className="block truncate text-sm font-medium text-brand-700 hover:underline">{patient.lastName}, {patient.firstName}</Link>
                      <div className="truncate text-xs text-slate-500">Dr. {provider.lastName}{appt.reason ? ` · ${appt.reason}` : ""}</div>
                    </div>
                    {appt.status === "checked_in" ? (
                      <Link href={`/encounters/new?patientId=${patient.id}&providerId=${provider.id}&appointmentId=${appt.id}`} className="btn btn-primary shrink-0 whitespace-nowrap px-2.5 py-1 text-xs">Enter charges</Link>
                    ) : (
                      <Badge tone={STATUS[appt.status]?.tone ?? "slate"}>{STATUS[appt.status]?.label ?? appt.status}</Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {today.length > 8 && <p className="mt-2 text-xs text-slate-500">And {today.length - 8} more on the schedule.</p>}
          </Panel>

          <Panel icon={Gavel} title="Won back on appeal" action={<span className="text-xs font-semibold text-green-700">{compactMoney(recovered.amountCents)} in 90 days</span>}>
            {recovered.rows.length === 0 ? (
              <p className="text-sm text-slate-500">No appeals won in the last 90 days yet.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {recovered.rows.slice(0, 5).map((d) => (
                  <li key={d.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">{d.patient}</div>
                      <div className="truncate text-xs text-slate-500">
                        <Link href={`/claims/${d.claimId}`} className="font-mono text-brand-700 hover:underline">{d.controlNumber}</Link> · CARC {d.carc} · <span className="capitalize">{d.category.replace(/_/g, " ")}</span>
                      </div>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-green-700">+{compactMoney(d.recoveredCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
