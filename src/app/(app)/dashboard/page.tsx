import Link from "next/link";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, Send, TrendingUp } from "lucide-react";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { userWorkload, recentPayments, recoveredDenials, collectionsSummary } from "@/server/analytics";
import { listAppointments } from "@/server/encounters";
import { Card, PageHeader, Badge, Empty } from "@/components/ui";
import { Kpi, compactMoney, pct } from "@/components/kpi";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function UserDashboard() {
  const s = await requireSession();
  const db = await getDb();

  const [work, payments, recovered, today, money] = await Promise.all([
    userWorkload(db, s.practiceId, s.userId),
    recentPayments(db, s.practiceId),
    recoveredDenials(db, s.practiceId),
    listAppointments(db, s.practiceId, new Date()),
    collectionsSummary(db, s.practiceId),
  ]);

  const firstName = s.name.split(" ")[0];
  const roleLabel = s.role.replace("_", " ");

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName}`}
        subtitle={`Your work queue · signed in as ${roleLabel}`}
        actions={
          <>
            {s.role === "admin" && <Link href="/admin" className="btn btn-secondary">Practice analytics</Link>}
            <Link href="/encounters/new" className="btn btn-primary">New charge</Link>
          </>
        }
      />

      {/* Money collected leads the page. The work counters below are a queue,
          not a scorecard, so they are toned as workload rather than failure. */}
      <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-emerald-50/60 to-white">
        <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,2fr)] lg:items-center">
          <div>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-bold uppercase tracking-widest text-emerald-700">Collected, last 30 days</span>
            </div>
            <div className="mt-2 text-4xl font-extrabold tracking-tight tabular-nums text-emerald-700 lg:text-5xl">
              {compactMoney(money.last30)}
            </div>
            <p className="mt-2 text-sm text-emerald-900/70">
              {money.postedCount30.toLocaleString()} payments posted ·{" "}
              {money.charges30 > 0 ? pct(money.last30 / money.charges30, 0) : "0%"} of charges billed in the same period
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Today", value: compactMoney(money.today) },
              { label: "Last 7 days", value: compactMoney(money.last7) },
              { label: "Last 12 months", value: compactMoney(money.last365) },
              { label: "Best month", value: money.bestMonth ? compactMoney(money.bestMonth.amount) : "-", sub: money.bestMonth?.month },
            ].map((m) => (
              <div key={m.label} className="rounded-xl border border-emerald-200/70 bg-white/80 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700/70">{m.label}</div>
                <div className="mt-1 text-lg font-bold tabular-nums text-slate-900">{m.value}</div>
                {m.sub && <div className="text-[11px] text-slate-400">{m.sub}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Assigned denials"
          value={work.assignedOpen.toLocaleString()}
          tone="neutral"
          hint={`${compactMoney(work.assignedOpenCents)} recoverable`}
        />
        <Kpi
          label="Appeals due soon"
          value={work.dueSoon.toLocaleString()}
          tone={work.dueSoon === 0 ? "good" : "warn"}
          hint="Within 14 days"
        />
        <Kpi
          label="Appeals overdue"
          value={work.overdueAppeals.toLocaleString()}
          tone={work.overdueAppeals === 0 ? "good" : "bad"}
          hint={work.overdueAppeals === 0 ? "Nothing past deadline" : "Past the payer deadline"}
        />
        {/* Judged as a share of all claims, not by being non-zero. Every
            practice always has some claims in rework; what matters is whether
            the backlog is small. Under 1% is healthy. */}
        <Kpi
          label="Claims to fix"
          value={work.needsAttention.toLocaleString()}
          tone={work.needsAttentionShare < 0.01 ? "good" : work.needsAttentionShare < 0.03 ? "warn" : "bad"}
          hint={`${pct(work.needsAttentionShare, 1)} of all claims`}
          target="Healthy under 1%"
        />
        <Kpi
          label="Ready to submit"
          value={work.readyToSubmit.toLocaleString()}
          tone="neutral"
          hint="Passed scrubbing, ready to bill"
        />
        <Kpi
          label="Resolved (30d)"
          value={work.resolved30.toLocaleString()}
          tone="good"
          hint="Denials you closed"
        />
      </div>

      {s.role === "admin" && (
        <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Practice, last 30 days</span>
          <span>Charges <strong className="tabular-nums">{compactMoney(money.charges30)}</strong></span>
          <span>Collected <strong className="tabular-nums text-emerald-700">{compactMoney(money.last30)}</strong></span>
          <Link href="/admin" className="ml-auto text-xs font-semibold text-brand-700 underline">Full analytics</Link>
        </div>
      )}

      {/* The two panels below report money in, not problems out. The queues
          they replaced live on /claims and /denials, reachable from the
          counters above and the sidebar. */}
      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card
          title="Payments just posted"
          actions={<Link href="/remittance" className="text-xs font-semibold text-brand-700 hover:underline">Remittance</Link>}
        >
          {payments.length === 0 ? (
            <Empty>No payments posted yet.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Claim</th><th>Patient</th><th>Payer</th><th>Source</th><th className="text-right">Paid</th><th>Posted</th></tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td><Link href={`/claims/${p.claimId}`} className="font-mono text-brand-700 hover:underline">{p.controlNumber}</Link></td>
                    <td>{p.patient}</td>
                    <td className="text-slate-600">{p.payer}</td>
                    <td><Badge tone="green">{p.source}</Badge></td>
                    <td className="text-right font-bold tabular-nums text-emerald-700">+{compactMoney(p.amountCents)}</td>
                    <td className="whitespace-nowrap text-slate-500">{fmtDate(p.postedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title="Denials recovered"
          actions={
            <span className="text-xs font-semibold text-emerald-700">
              {recovered.count.toLocaleString()} won · {compactMoney(recovered.amountCents)} back
            </span>
          }
        >
          {recovered.rows.length === 0 ? (
            <Empty>No appeals resolved in the last 90 days.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Claim</th><th>Patient</th><th>Payer</th><th>Overturned</th><th className="text-right">Recovered</th></tr>
              </thead>
              <tbody>
                {recovered.rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/claims/${d.claimId}`} className="font-mono text-brand-700 hover:underline">{d.controlNumber}</Link>
                      <div className="text-xs capitalize text-slate-400">{d.category.replace(/_/g, " ")}</div>
                    </td>
                    <td>{d.patient}</td>
                    <td className="text-slate-600">{d.payer}</td>
                    <td><Badge tone="green">CARC {d.carc} won</Badge></td>
                    <td className="text-right font-bold tabular-nums text-emerald-700">+{compactMoney(d.recoveredCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card
          title={`Today's schedule (${work.todaysAppointments})`}
          className="xl:col-span-2"
          actions={<Link href="/scheduling" className="text-xs font-semibold text-brand-700 hover:underline">Full scheduler</Link>}
        >
          {today.length === 0 ? (
            <Empty>Nothing booked today.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Time</th><th>Patient</th><th>Provider</th><th>Reason</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {today.slice(0, 10).map(({ appt, patient, provider }) => (
                  <tr key={appt.id}>
                    <td className="whitespace-nowrap font-medium">{appt.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</td>
                    <td><Link href={`/patients/${patient.id}`} className="text-brand-700 hover:underline">{patient.lastName}, {patient.firstName}</Link></td>
                    <td className="text-slate-600">Dr. {provider.lastName}</td>
                    <td className="text-slate-500">{appt.reason}</td>
                    <td><Badge tone={appt.status === "checked_in" ? "amber" : "blue"}>{appt.status.replace("_", " ")}</Badge></td>
                    <td>
                      {appt.status === "checked_in" && (
                        <Link href={`/encounters/new?patientId=${patient.id}&providerId=${provider.id}&appointmentId=${appt.id}`} className="btn btn-primary text-xs">
                          Charges
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Jump to">
          <div className="space-y-2 text-sm">
            <Link href="/claims?status=ready" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <Send className="h-4 w-4 text-brand-600" />
              <span className="flex-1">Submit ready claims</span>
              <span className="font-semibold tabular-nums">{work.readyToSubmit.toLocaleString()}</span>
            </Link>
            <Link href="/claims?status=scrub_errors" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="flex-1">Fix scrub errors</span>
              <span className="font-semibold tabular-nums">{work.needsAttention.toLocaleString()}</span>
            </Link>
            <Link href="/denials?status=open" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <ClipboardList className="h-4 w-4 text-rose-600" />
              <span className="flex-1">Work open denials</span>
              <span className="font-semibold tabular-nums">{work.assignedOpen.toLocaleString()}</span>
            </Link>
            <Link href="/scheduling" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <CalendarDays className="h-4 w-4 text-sky-600" />
              <span className="flex-1">Checked in now</span>
              <span className="font-semibold tabular-nums">{work.checkedIn.toLocaleString()}</span>
            </Link>
            <Link href="/remittance" className="flex items-center gap-3 rounded-lg border border-slate-200 p-3 hover:bg-slate-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="flex-1">Post remittances</span>
            </Link>
          </div>
          <p className="mt-3 text-xs text-slate-400">Updated {fmtDate(new Date())}</p>
        </Card>
      </div>
    </>
  );
}
