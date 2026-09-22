import Link from "next/link";
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, Send } from "lucide-react";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { userWorkload, myDenialQueue, claimsNeedingAttention, headlineKpis } from "@/server/analytics";
import { listAppointments } from "@/server/encounters";
import { Card, PageHeader, StatusBadge, Badge, Empty } from "@/components/ui";
import { Kpi, compactMoney, pct } from "@/components/kpi";
import { fmtDate, daysAgo } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function UserDashboard() {
  const s = await requireSession();
  const db = await getDb();

  const [work, denials, attention, today, kpis] = await Promise.all([
    userWorkload(db, s.practiceId, s.userId),
    myDenialQueue(db, s.practiceId, s.userId),
    claimsNeedingAttention(db, s.practiceId),
    listAppointments(db, s.practiceId, new Date()),
    s.role === "admin" ? headlineKpis(db, s.practiceId, 1) : Promise.resolve(null),
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Assigned denials"
          value={work.assignedOpen.toLocaleString()}
          tone={work.assignedOpen === 0 ? "good" : work.assignedOpen > 25 ? "bad" : "warn"}
          hint={`${compactMoney(work.assignedOpenCents)} at risk`}
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
          hint="Past the payer deadline"
        />
        <Kpi
          label="Claims to fix"
          value={work.needsAttention.toLocaleString()}
          tone={work.needsAttention === 0 ? "good" : "warn"}
          hint="Scrub errors or rejected"
        />
        <Kpi
          label="Ready to submit"
          value={work.readyToSubmit.toLocaleString()}
          tone={work.readyToSubmit > 0 ? "warn" : "good"}
          hint="Passed scrubbing"
        />
        <Kpi
          label="Resolved (30d)"
          value={work.resolved30.toLocaleString()}
          tone="good"
          hint="Denials you closed"
        />
      </div>

      {kpis && (
        <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Practice, last 30 days</span>
          <span>Charges <strong className="tabular-nums">{compactMoney(kpis.chargesCents)}</strong></span>
          <span>Collections <strong className="tabular-nums text-emerald-700">{compactMoney(kpis.insurancePaidCents + kpis.patientPaidCents)}</strong></span>
          <span>Denial rate <strong className="tabular-nums">{pct(kpis.denialRate)}</strong></span>
          <Link href="/admin" className="ml-auto text-xs font-semibold text-brand-700 underline">Full analytics</Link>
        </div>
      )}

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card
          title="My denial queue"
          actions={<Link href="/denials" className="text-xs font-semibold text-brand-700 hover:underline">All denials</Link>}
        >
          {denials.length === 0 ? (
            <Empty>Nothing assigned to you. <CheckCircle2 className="inline h-4 w-4 text-emerald-600" /></Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Claim</th><th>Patient</th><th>Reason</th><th className="text-right">Amount</th><th>Appeal by</th></tr>
              </thead>
              <tbody>
                {denials.map((d) => {
                  const left = d.appealDeadline ? -daysAgo(d.appealDeadline + "T00:00:00") : null;
                  return (
                    <tr key={d.id}>
                      <td>
                        <Link href={`/claims/${d.claimId}`} className="font-mono text-brand-700 hover:underline">{d.controlNumber}</Link>
                        <div className="text-xs text-slate-400">{d.payer}</div>
                      </td>
                      <td>{d.patient}</td>
                      <td>
                        <Badge tone="red">CARC {d.carc}</Badge>
                        <div className="mt-0.5 text-xs capitalize text-slate-500">{d.category.replace(/_/g, " ")}</div>
                      </td>
                      <td className="text-right font-semibold tabular-nums">{compactMoney(d.amountCents)}</td>
                      <td className={left !== null && left < 14 ? "font-semibold text-red-700" : "text-slate-500"}>
                        {left === null ? "-" : left < 0 ? `${-left}d overdue` : `${left}d left`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card
          title="Claims needing attention"
          actions={<Link href="/claims?status=scrub_errors" className="text-xs font-semibold text-brand-700 hover:underline">Open worklist</Link>}
        >
          {attention.length === 0 ? (
            <Empty>No blocked claims. <CheckCircle2 className="inline h-4 w-4 text-emerald-600" /></Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Claim</th><th>Patient</th><th>Payer</th><th>Status</th><th className="text-right">Billed</th><th>Filing</th></tr>
              </thead>
              <tbody>
                {attention.map((c) => {
                  const left = c.deadline ? -daysAgo(c.deadline + "T00:00:00") : null;
                  return (
                    <tr key={c.id}>
                      <td><Link href={`/claims/${c.id}`} className="font-mono text-brand-700 hover:underline">{c.controlNumber}</Link></td>
                      <td>{c.patient}</td>
                      <td className="text-slate-600">{c.payer}</td>
                      <td><StatusBadge status={c.status} /></td>
                      <td className="text-right tabular-nums">{compactMoney(c.totalCents)}</td>
                      <td className={left !== null && left < 14 ? "font-semibold text-red-700" : "text-slate-500"}>
                        {left === null ? "-" : left < 0 ? `${-left}d over` : `${left}d`}
                      </td>
                    </tr>
                  );
                })}
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
