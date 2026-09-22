import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listAppointments, listProviders } from "@/server/encounters";
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
        <Card title={`Appointments (${appts.length})`} className="lg:col-span-2">
          {appts.length === 0 ? (
            <Empty>No appointments on this day.</Empty>
          ) : (
            <table className="table">
              <thead><tr><th>Time</th><th>Patient</th><th>Provider</th><th>Type</th><th>Reason</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {appts.map(({ appt, patient, provider }) => (
                  <tr key={appt.id}>
                    <td className="whitespace-nowrap font-medium">{appt.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</td>
                    <td><PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} /></td>
                    <td>Dr. {provider.lastName}</td>
                    <td>{appt.type.replace(/_/g, " ")}</td>
                    <td className="text-slate-500">{appt.reason}</td>
                    <td><Badge tone={TONE[appt.status] ?? "slate"}>{appt.status.replace("_", " ")}</Badge></td>
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
