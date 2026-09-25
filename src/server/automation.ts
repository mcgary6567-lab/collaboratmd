/**
 * The daily job: reminders, claim follow-up, autopay and the weekly report,
 * for each practice that has switched them on. Each step records what it did
 * and never repeats itself: a reminder is sent once per appointment, a
 * balance reminder at most once a month, and so on, so the job can safely
 * run more than once a day.
 */
import { and, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { AutomationSettings } from "@/db/schema";
import { createCheckinLink } from "./checkin";
import { createPortalLink, chargeAutopay } from "./portal";
import { messagePatient } from "./messaging";
import { patientsWithBalances, refreshPlanStatuses } from "./billing";
import { runFollowUp, followUpSummary } from "./followup";
import { arAging, headlineKpis } from "./analytics";
import { sendEmail } from "./notify";
import { stripeReady } from "@/lib/stripe";
import { practiceConfig } from "./integrations";
import { runDenialAgent } from "./denial-agent";
import { applyRules, hasActiveRules } from "./work-rules";
import { hasScheduledReports, sendScheduledReports } from "./report-builder";

const { appointments, patients, practices, messageLog, statements, automationRuns, users, tasks, paymentPlans } = schema;

const when = (d: Date) => d.toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

async function alreadySent(db: Db, practiceId: string, kind: string, entityId: string, sinceDays?: number) {
  const [row] = await db
    .select({ id: messageLog.id })
    .from(messageLog)
    .where(and(eq(messageLog.practiceId, practiceId), eq(messageLog.kind, kind), eq(messageLog.entityId, entityId), inArray(messageLog.status, ["sent"]),
      ...(sinceDays ? [gte(messageLog.createdAt, new Date(Date.now() - sinceDays * 86_400_000))] : [])))
    .limit(1);
  return !!row;
}

/**
 * Text-to-pay on demand: a secure pay link, by text where the patient agreed
 * to texts and by email otherwise, to every patient owing at least
 * `minCents` who is not on a plan or in collections and has not had a pay
 * link in the last 7 days. Opt-outs are honored.
 */
export async function sendPayLinks(db: Db, practiceId: string, origin: string, opts: { minCents?: number; limit?: number } = {}) {
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const owing = await patientsWithBalances(db, practiceId, Math.max(100, opts.minCents ?? 2_500), Math.min(opts.limit ?? 200, 500));
  let sent = 0;
  let skipped = 0;
  let excluded = 0;
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  for (const o of owing) {
    const [[plan], [open], [recent]] = await Promise.all([
      db.select({ id: paymentPlans.id }).from(paymentPlans).where(and(eq(paymentPlans.patientId, o.patientId), inArray(paymentPlans.status, ["active", "defaulted"]))).limit(1),
      db.select({ id: schema.patientCollections.id }).from(schema.patientCollections).where(and(eq(schema.patientCollections.patientId, o.patientId), isNull(schema.patientCollections.closedAt))).limit(1),
      db.select({ id: messageLog.id }).from(messageLog).where(and(eq(messageLog.patientId, o.patientId), inArray(messageLog.kind, ["pay_link", "balance_reminder"]), eq(messageLog.status, "sent"), gte(messageLog.createdAt, weekAgo))).limit(1),
    ]);
    if (plan || open || recent) {
      excluded++;
      continue;
    }
    const link = await createPortalLink(db, practiceId, o.patientId, undefined, "pay");
    const url = `${origin}${link.path}`;
    const amount = `$${(o.balanceCents / 100).toFixed(2)}`;
    const r = await messagePatient(db, link.patient, {
      kind: "pay_link", entityId: o.patientId, reminder: true,
      sms: `${practice.name}: your balance is ${amount}. Pay securely by card: ${url} . Reply STOP to opt out.`,
      email: { subject: `Pay your balance with ${practice.name}`, text: `Hi ${link.patient.firstName},\n\nYour balance with ${practice.name} is ${amount}. You can see what it is for and pay securely by card here:\n\n${url}\n\nThe link asks for your date of birth and works for 30 days.\n\n${practice.name}` },
    });
    if (r.sms === "sent" || r.email === "sent") sent++;
    else skipped++;
  }
  return { candidates: owing.length, sent, skipped, excluded };
}

/** Tomorrow's appointments, each reminded once, with an online check-in link. */
export async function appointmentReminders(db: Db, practiceId: string, origin: string, now = new Date()) {
  const from = new Date(now.getTime() + 18 * 3_600_000);
  const to = new Date(now.getTime() + 42 * 3_600_000);
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const rows = await db
    .select({ appt: appointments, patient: patients })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .where(and(eq(appointments.practiceId, practiceId), eq(appointments.status, "scheduled"), gte(appointments.startsAt, from), lt(appointments.startsAt, to)));
  let sent = 0;
  let skipped = 0;
  for (const { appt, patient } of rows) {
    if (await alreadySent(db, practiceId, "appointment_reminder", appt.id)) continue;
    const link = await createCheckinLink(db, practiceId, appt.id);
    const url = `${origin}${link.path}`;
    const r = await messagePatient(db, patient, {
      kind: "appointment_reminder", entityId: appt.id, reminder: true,
      sms: `${practice.name}: reminder of your appointment ${when(appt.startsAt)}. Check in online: ${url} . Reply STOP to opt out.`,
      email: { subject: `Your appointment with ${practice.name}`, text: `Hi ${patient.firstName},\n\nThis is a reminder of your appointment on ${when(appt.startsAt)}.\n\nSave time by checking in online:\n${url}\n\n${practice.name}${practice.phone ? `\n${practice.phone}` : ""}` },
    });
    if (r.sms === "sent" || r.email === "sent") sent++;
    else skipped++;
  }
  return { due: rows.length, sent, skipped };
}

/**
 * A pay link to patients who owe at least $25, have had a statement at least
 * two weeks ago, are not on a payment plan, and were not reminded in the last
 * 30 days.
 */
export async function balanceReminders(db: Db, practiceId: string, origin: string, limit = 200) {
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const owing = await patientsWithBalances(db, practiceId, 2_500, limit);
  const twoWeeks = new Date(Date.now() - 14 * 86_400_000);
  let sent = 0;
  let skipped = 0;
  for (const o of owing) {
    const [stmt] = await db.select({ at: statements.createdAt }).from(statements).where(and(eq(statements.patientId, o.patientId), sql`${statements.status} <> 'void'`)).orderBy(desc(statements.createdAt)).limit(1);
    if (!stmt || stmt.at > twoWeeks) continue;
    const [plan] = await db.select({ id: paymentPlans.id }).from(paymentPlans).where(and(eq(paymentPlans.patientId, o.patientId), inArray(paymentPlans.status, ["active", "defaulted"]))).limit(1);
    if (plan) continue;
    // Accounts in collections get the final notice instead.
    const [open] = await db.select({ id: schema.patientCollections.id }).from(schema.patientCollections).where(and(eq(schema.patientCollections.patientId, o.patientId), isNull(schema.patientCollections.closedAt))).limit(1);
    if (open) continue;
    if (await alreadySent(db, practiceId, "balance_reminder", o.patientId, 30)) continue;
    const [patient] = await db.select().from(patients).where(eq(patients.id, o.patientId)).limit(1);
    const link = await createPortalLink(db, practiceId, o.patientId, undefined, "pay");
    const url = `${origin}${link.path}`;
    const amount = `$${(o.balanceCents / 100).toFixed(2)}`;
    const r = await messagePatient(db, patient, {
      kind: "balance_reminder", entityId: o.patientId, reminder: true,
      sms: `${practice.name}: you have a balance of ${amount}. View and pay securely: ${url} . Reply STOP to opt out.`,
      email: { subject: `Your balance with ${practice.name}`, text: `Hi ${patient.firstName},\n\nYour balance with ${practice.name} is ${amount}. You can see what it is for and pay securely here:\n\n${url}\n\nIf you would like a payment plan, reply to this email or call the office${practice.phone ? ` at ${practice.phone}` : ""}.\n\n${practice.name}` },
    });
    if (r.sms === "sent" || r.email === "sent") sent++;
    else skipped++;
  }
  return { candidates: owing.length, sent, skipped };
}

/** A plain-text summary of the week for the practice's administrators. */
export async function weeklyReportText(db: Db, practiceId: string) {
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const [k, aging, followUp] = await Promise.all([headlineKpis(db, practiceId, 1), arAging(db, practiceId), followUpSummary(db, practiceId)]);
  const [{ overdue }] = await db.select({ overdue: sql<number>`count(*)::int` }).from(tasks).where(and(eq(tasks.practiceId, practiceId), eq(tasks.status, "open"), lt(tasks.dueDate, new Date().toISOString().slice(0, 10))));
  const $ = (c: number) => `$${Math.round(c / 100).toLocaleString("en-US")}`;
  const pct = (v: number | null) => (v === null ? "n/a" : `${(v * 100).toFixed(1)}%`);
  const over90 = aging.totals.b91_120 + aging.totals.b120p;
  return [
    `${practice.name}: the last 30 days`,
    "",
    `Charges billed      ${$(k.chargesCents)}`,
    `Collected           ${$(k.insurancePaidCents + k.patientPaidCents)} (insurance ${$(k.insurancePaidCents)}, patients ${$(k.patientPaidCents)})`,
    `Clean claim rate    ${pct(k.cleanClaimRate)}`,
    `Denial rate         ${pct(k.denialRate)}`,
    `Days in A/R         ${k.daysInAr}`,
    `A/R over 90 days    ${$(over90)} of ${$(aging.totals.total)}`,
    `Open denials        ${k.openDenials} (${$(k.openDenialCents)})`,
    `Unpaid past 30 days ${followUp.count} claims (${$(followUp.cents)})`,
    `Overdue tasks       ${Number(overdue)}`,
    "",
    "Sent by CollaboratMD. Turn this report off in Settings, Automation.",
  ].join("\n");
}

export async function sendWeeklyReport(db: Db, practiceId: string) {
  const admins = await db.select({ email: users.email }).from(users).where(and(eq(users.practiceId, practiceId), eq(users.role, "admin")));
  const [practice] = await db.select({ name: practices.name }).from(practices).where(eq(practices.id, practiceId)).limit(1);
  const text = await weeklyReportText(db, practiceId);
  let sent = 0;
  for (const a of admins) {
    const ok = await sendEmail(a.email, `Weekly revenue report: ${practice.name}`, text, undefined, (await practiceConfig(db, practiceId)).resend);
    await db.insert(messageLog).values({ practiceId, channel: "email", kind: "report", recipient: a.email, status: ok ? "sent" : "failed" });
    if (ok) sent++;
  }
  return { recipients: admins.length, sent };
}

/** Everything the daily job does for one practice, per its switches. */
export async function runDailyForPractice(db: Db, practiceId: string, origin: string, now = new Date()) {
  const [practice] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  const s: AutomationSettings = practice.automation ?? {};
  const summary: Record<string, unknown> = {};
  let error: string | null = null;
  const step = async (name: string, fn: () => Promise<unknown>) => {
    try {
      summary[name] = await fn();
    } catch (e) {
      summary[name] = { error: e instanceof Error ? e.message : "failed" };
      error = `${name}: ${e instanceof Error ? e.message : "failed"}`;
    }
  };
  await step("planStatuses", () => refreshPlanStatuses(db, practiceId).then(() => "refreshed"));
  if (s.appointmentReminders) await step("appointmentReminders", () => appointmentReminders(db, practiceId, origin, now));
  if (s.balanceReminders) await step("balanceReminders", () => balanceReminders(db, practiceId, origin));
  if (s.claimFollowUp) await step("claimFollowUp", () => runFollowUp(db, practiceId));
  if (s.denialAgent) await step("denialAgent", () => runDenialAgent(db, practiceId, { limit: 50 }));
  if (await hasActiveRules(db, practiceId)) await step("workRules", () => applyRules(db, practiceId, { now }));
  if (s.autopay && stripeReady((await practiceConfig(db, practiceId)).stripe)) await step("autopay", () => chargeAutopay(db, practiceId));
  if (s.weeklyReport && now.getUTCDay() === 1) await step("weeklyReport", () => sendWeeklyReport(db, practiceId));
  const resend = (await practiceConfig(db, practiceId)).resend;
  if (resend && (await hasScheduledReports(db, practiceId))) await step("scheduledReports", () => sendScheduledReports(db, practiceId, origin, (to, subject, text) => sendEmail(to, subject, text, undefined, resend), now));
  await db.insert(automationRuns).values({ practiceId, summary, error });
  return summary;
}

export async function runDaily(db: Db, origin: string, now = new Date()) {
  const all = await db.select({ id: practices.id }).from(practices);
  const out: Record<string, unknown> = {};
  for (const p of all) out[p.id] = await runDailyForPractice(db, p.id, origin, now);
  return out;
}

export async function recentRuns(db: Db, practiceId: string, limit = 10) {
  return db.select().from(automationRuns).where(eq(automationRuns.practiceId, practiceId)).orderBy(desc(automationRuns.ranAt)).limit(limit);
}
