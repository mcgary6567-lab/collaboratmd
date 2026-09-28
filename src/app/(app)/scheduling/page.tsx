import type { Metadata } from "next";
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
import { localDateLabel, localTimeLabel, pendingRequests } from "@/server/booking";
import { practiceNow } from "@/server/practice-time";
import { confirmBookingAction, declineBookingAction } from "@/app/(app)/booking-actions";
import { offerSlotAction, removeFromWaitlistAction } from "@/app/(app)/waitlist-actions";
import { listWaitlist, offersFor, windowLabel } from "@/server/waitlist";
import { undeliveredReminders } from "@/server/sms-delivery";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Schedule" };

export const dynamic = "force-dynamic";

const TONE: Record<string, "slate" | "green" | "red" | "amber" | "blue"> = { scheduled: "blue", checked_in: "amber", completed: "green", no_show: "red", cancelled: "slate" };

export default async function SchedulingPage({ searchParams }: { searchParams: Promise<{ date?: string; booked?: string; told?: string; declined?: string; waitlisted?: string }> }) {
  const { date, booked, told, declined, waitlisted } = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  // A clock time on the day shown: the date asked for, or today on the practice's clock.
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + "T12:00:00Z") : await practiceNow(db, s.practiceId);
  const [appts, providers, requests] = await Promise.all([listAppointments(db, s.practiceId, day), listProviders(db, s.practiceId), pendingRequests(db, s.practiceId)]);
  const iso = day.toISOString().slice(0, 10);
  const patientIds = [...new Set(appts.map((a) => a.patient.id))];
  const primaries = patientIds.length
    ? await db
        .select({ id: schema.patientInsurances.id, patientId: schema.patientInsurances.patientId })
        .from(schema.patientInsurances)
        .where(and(inArray(schema.patientInsurances.patientId, patientIds), eq(schema.patientInsurances.active, true), eq(schema.patientInsurances.rank, 1)))
    : [];
  const insByPatient = new Map(primaries.map((p) => [p.patientId, p.id]));
  const clockNow = await practiceNow(db, s.practiceId);
  const cancelled = appts.filter((a) => a.appt.status === "cancelled" && a.appt.startsAt > clockNow).map((a) => a.appt.id);
  const [checks, checkins, offers, waitlist, undelivered] = await Promise.all([latestChecks(db, primaries.map((p) => p.id)), checkinStatus(db, appts.map((a) => a.appt.id)), offersFor(db, cancelled), listWaitlist(db, s.practiceId), undeliveredReminders(db, s.practiceId, appts.map((a) => a.appt.id))]);
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
      {booked && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-900" role="status">
          Online request booked {booked === "existing" ? "for the existing patient" : "with a new patient record"}. {told === "1" ? "The patient was told." : "Let the patient know; no message could be sent."}
        </div>
      )}
      {waitlisted && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-900" role="status">
          Added to the waitlist {waitlisted === "existing" ? "(an existing patient)" : "with a new patient record"}. {told === "1" ? "The patient was told." : "Let the patient know; no message could be sent."}
        </div>
      )}
      {declined && <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-800" role="status">Request declined. Contact the patient to offer another time.</div>}
      {requests.length > 0 && (
        <Card title={`Online requests waiting (${requests.length})`} className="mb-6">
          <ul className="divide-y divide-slate-100 text-sm">
            {requests.map(({ request: r, providerFirst, providerLast }) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div>
                  <div className="font-medium">{r.lastName}, {r.firstName} <span className="font-normal text-slate-500">· born {fmtDate(r.dob)}</span></div>
                  <div className="text-slate-600">
                    {r.kind === "waitlist" || !r.startsAt
                      ? <>Wants to join the waitlist: {providerLast ? `Dr. ${providerFirst} ${providerLast}` : "any provider"}, {windowLabel(r.fromHour, r.untilHour)}{r.smsConsent ? "" : " (no texting consent: call when a time opens)"}</>
                      : <>{localDateLabel(r.startsAt)} at {localTimeLabel(r.startsAt)} with Dr. {providerFirst} {providerLast}</>}
                    {r.reason ? ` · ${r.reason}` : ""}
                  </div>
                  <div className="text-xs text-slate-500">{[r.phone, r.email, r.payerName && `${r.payerName}${r.memberId ? ` ${r.memberId}` : ""}`].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex gap-2">
                  <ActionForm action={confirmBookingAction.bind(null, r.id)}><SubmitButton className="btn btn-primary text-xs" pendingLabel="Booking...">Confirm</SubmitButton></ActionForm>
                  <ActionForm action={declineBookingAction.bind(null, r.id)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Decline</SubmitButton></ActionForm>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {/* Side by side only on wide screens: below that the schedule needs the full width for its columns and buttons. */}
      <div className="grid gap-6 2xl:grid-cols-3">
        <Card
          title={`Appointments (${appts.length})`}
          /* min-w-0: a grid item otherwise grows to its table width and slides under the booking card beside it. */
          className="min-w-0 2xl:col-span-2"
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
            <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Time</th><th>Patient</th><th>Provider</th><th>Type</th><th>Reason</th><th>Coverage</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {appts.map(({ appt, patient, provider }) => (
                  <tr key={appt.id}>
                    <td data-label="Time" className="whitespace-nowrap font-medium">{appt.startsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" })}</td>
                    <td data-label="Patient"><PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} /></td>
                    <td data-label="Provider">Dr. {provider.lastName}</td>
                    <td data-label="Type">{appt.type.replace(/_/g, " ")}</td>
                    <td data-label="Reason" className="text-slate-500">{appt.reason}</td>
                    <td data-label="Coverage" title={coverage(patient.id).title}><Badge tone={coverage(patient.id).tone}>{coverage(patient.id).label}</Badge></td>
                    <td data-label="Status">
                      <Badge tone={TONE[appt.status] ?? "slate"}>{appt.status.replace("_", " ")}</Badge>
                      {appt.status === "scheduled" && appt.confirmedAt && <div className="mt-1 text-[11px] font-semibold text-green-700">Confirmed{appt.confirmedVia === "sms" ? " by text" : ""}</div>}
                      {appt.status === "scheduled" && !appt.confirmedAt && undelivered.has(appt.id) && <div className="mt-1 text-[11px] font-semibold text-red-700" title="Twilio reported the reminder text did not reach the phone">Reminder not delivered: call</div>}
                      {checkins.get(appt.id)?.submission && (
                        <div className="mt-1"><Link href="/check-ins" className="text-[11px] font-semibold text-brand-700 hover:underline">Checked in online</Link></div>
                      )}
                    </td>
                    <td data-label="">
                      <div className="flex min-w-[15rem] flex-wrap items-start gap-1">
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
                        <span><CheckinLinkButton appointmentId={appt.id} resend={!!checkins.get(appt.id)?.link} /></span>
                      )}
                      {appt.status === "scheduled" && (
                        <form action={appointmentStatusAction.bind(null, appt.id, "no_show")} className="inline">
                          <button className="btn btn-secondary text-xs">No-show</button>
                        </form>
                      )}
                      {appt.status === "scheduled" && appt.startsAt > clockNow && (
                        <form action={appointmentStatusAction.bind(null, appt.id, "cancelled")} className="inline">
                          <button className="btn btn-secondary text-xs" title="The patient called to cancel. The time can then be offered to the waitlist.">Cancel</button>
                        </form>
                      )}
                      {cancelled.includes(appt.id) && (offers.get(appt.id) ? (
                        <span className="text-[11px] font-semibold text-slate-600">
                          {offers.get(appt.id)!.filled
                            ? "Filled from the waitlist"
                            : `Offered to ${offers.get(appt.id)!.sent} on the waitlist${offers.get(appt.id)!.rounds > 1 ? ` in ${offers.get(appt.id)!.rounds} rounds` : ""}${offers.get(appt.id)!.undelivered ? ` (${offers.get(appt.id)!.undelivered} not delivered)` : ""}`}
                        </span>
                      ) : waitlist.length > 0 ? (
                        <ActionForm action={offerSlotAction.bind(null, appt.id)}>
                          <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Texting...">Offer to waitlist</SubmitButton>
                        </ActionForm>
                      ) : null)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>
        <Card title="Book appointment">
          <AppointmentForm date={iso} providers={providers.map((p) => ({ id: p.id, name: `Dr. ${p.firstName} ${p.lastName} — ${p.specialty}` }))} />
        </Card>
      </div>
      <Card title={`Waitlist (${waitlist.length})`} className="mt-6">
        <p className="mb-3 text-xs text-slate-500">
          Patients who want an earlier time. When a patient replies X to their reminder, the time is texted to the first few who can take it; the first to reply B is booked and you get a notification. For a cancellation by phone, press Cancel, then Offer to waitlist. Add patients from their page.
        </p>
        {waitlist.length === 0 ? <Empty>Nobody is waiting.</Empty> : (
          <ul className="divide-y divide-slate-100 text-sm">
            {waitlist.map(({ entry, patient, providerLast, canText }) => (
              <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div>
                  <PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} />
                  <span className="text-slate-500"> · {providerLast ? `Dr. ${providerLast} only` : "any provider"} · {windowLabel(entry.fromHour, entry.untilHour)} · since {entry.createdAt.toISOString().slice(0, 10)}</span>
                  {entry.note && <div className="text-xs text-slate-600">{entry.note}</div>}
                  {!canText && <div className="text-xs text-amber-800">No texting consent: call when a time opens</div>}
                </div>
                <form action={removeFromWaitlistAction.bind(null, entry.id, patient.id)}>
                  <button className="text-xs font-semibold text-slate-500 hover:text-red-700" aria-label={`Remove ${patient.firstName} ${patient.lastName} from the waitlist`}>Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
