import Link from "next/link";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { listAppointments, listProviders } from "@/server/encounters";
import { latestChecks } from "@/server/patients";
import { checkinStatus } from "@/server/checkin";
import { CheckinLinkButton } from "./checkin-link";
import { verifyScheduleAction } from "@/app/(app)/eligibility-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { appointmentStatusAction } from "@/app/(app)/actions";
import { Card, PageHeader, PatientLink, Badge, Empty } from "@/components/ui";
import { AppointmentForm } from "./form";

export const dynamic = "force-dynamic";

const TONE: Record<string, "slate" | "green" | "red" | "amber" | "blue"> = { scheduled: "blue", checked_in: "amber", completed: "green", no_show: "red", cancelled: "slate" };

export default async function SchedulingPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { date } = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const day = date ? new Date(date + "T12:00:00") : new Date();
  const [appts, providers] = await Promise.all([listAppointments(db, s.practiceId, day), listProviders(db, s.practiceId)]);
  const iso = day.toISOString().slice(0, 10);
  const patientIds = [...new Set(appts.map((a) => a.patient.id))];
  const primaries = patientIds.length
    ? await db
        .select({ id: schema.patientInsurances.id, patientId: schema.patientInsurances.patientId })
        .from(schema.patientInsurances)
        .where(and(inArray(schema.patientInsurances.patientId, patientIds), eq(schema.patientInsurances.active, true), eq(schema.patientInsurances.rank, 1)))
    : [];
  const insByPatient = new Map(primaries.map((p) => [p.patientId, p.id]));
  const [checks, checkins] = await Promise.all([latestChecks(db, primaries.map((p) => p.id)), checkinStatus(db, appts.map((a) => a.appt.id))]);
  const coverage = (patientId: string) => {
    const insId = insByPatient.get(patientId);
    if (!insId) return { label: "No insurance", tone: "amber" as const, title: "Self-pay unless insurance is collected" };
    const c = checks.get(insId);
    if (!c) return { label: "Not checked", tone: "slate" as const, title: "" };
    const forDay = c.serviceDate === iso;
    if (c.status === "active") return { label: forDay ? "Verified" : "Active (earlier check)", tone: forDay ? ("green" as const) : ("blue" as const), title: c.planName ?? "" };
    return { label: c.status === "inactive" ? "Not covered" : "Check failed", tone: "red" as const, title: c.message ?? "" };
  };
  const shift = (n: number) => {
    const d = new Date(day);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  return (
    <>
      <PageHeader
        title="Scheduling"
        subtitle={day.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
        actions={
          <>
            <Link href={`/scheduling?date=${shift(-1)}`} className="btn btn-secondary">Previous</Link>
            <Link href="/scheduling" className="btn btn-secondary">Today</Link>
            <Link href={`/scheduling?date=${shift(1)}`} className="btn btn-secondary">Next</Link>
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title={`Appointments (${appts.length})`}
          className="lg:col-span-2"
          actions={
            appts.length > 0 ? (
              <ActionForm action={verifyScheduleAction.bind(null, iso)} className="flex flex-col items-end">
                <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Checking with payers...">Verify coverage for this day</SubmitButton>
              </ActionForm>
            ) : undefined
          }
        >
          {appts.length === 0 ? (
            <Empty>No appointments on this day.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Time</th><th>Patient</th><th>Provider</th><th>Type</th><th>Reason</th><th>Coverage</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {appts.map(({ appt, patient, provider }) => (
                  <tr key={appt.id}>
                    <td className="whitespace-nowrap font-medium">{appt.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</td>
                    <td><PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} /></td>
                    <td>Dr. {provider.lastName}</td>
                    <td>{appt.type.replace(/_/g, " ")}</td>
                    <td className="text-slate-500">{appt.reason}</td>
                    <td title={coverage(patient.id).title}><Badge tone={coverage(patient.id).tone}>{coverage(patient.id).label}</Badge></td>
                    <td>
                      <Badge tone={TONE[appt.status] ?? "slate"}>{appt.status.replace("_", " ")}</Badge>
                      {checkins.get(appt.id)?.submission && (
                        <div className="mt-1"><Link href="/check-ins" className="text-[11px] font-semibold text-brand-700 hover:underline">Checked in online</Link></div>
                      )}
                    </td>
                    <td className="whitespace-nowrap">
                      {appt.status === "scheduled" && (
                        <form action={appointmentStatusAction.bind(null, appt.id, "checked_in")} className="inline">
                          <button className="btn btn-secondary text-xs">Check in</button>
                        </form>
                      )}
                      {appt.status === "checked_in" && (
                        <Link href={`/encounters/new?patientId=${patient.id}&providerId=${provider.id}&appointmentId=${appt.id}&dos=${iso}`} className="btn btn-primary text-xs">
                          Enter charges
                        </Link>
                      )}
                      {appt.status === "scheduled" && !checkins.get(appt.id)?.submission && (
                        <span className="ml-1"><CheckinLinkButton appointmentId={appt.id} resend={!!checkins.get(appt.id)?.link} /></span>
                      )}
                      {appt.status === "scheduled" && (
                        <form action={appointmentStatusAction.bind(null, appt.id, "no_show")} className="ml-1 inline">
                          <button className="btn btn-secondary text-xs">No-show</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Book appointment">
          <AppointmentForm date={iso} providers={providers.map((p) => ({ id: p.id, name: `Dr. ${p.firstName} ${p.lastName} — ${p.specialty}` }))} />
        </Card>
      </div>
    </>
  );
}
