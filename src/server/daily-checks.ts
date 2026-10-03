/**
 * Checks that run every morning and turn into notifications for the
 * administrators: payers behaving differently, credentials and staff training about to expire,
 * and a quarterly access review that is due. Each carries a dedupe key, so
 * the same finding notifies once (per week for payer alerts, per expiry date
 * for credentials, per quarter for access reviews).
 */
import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { payerAlerts } from "./payer-alerts";
import { credentialState, CREDENTIAL_KINDS, listCredentials } from "./credentials";
import { notify } from "./notifications";
import { notifyAccessAnomalies } from "./access-anomalies";
import { practiceMaintenance } from "./maintenance";
import { coverageGaps } from "./shifts";
import { trainingReminders } from "./staff-training";

/** ISO week, e.g. 2026-W39, so a payer alert repeats at most weekly. */
function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const year = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(year, 0, 1)) / 86_400_000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}

export async function runDailyChecks(db: Db, practiceId: string, now = new Date()) {
  const out = { payerAlerts: 0, credentials: 0, accessReview: false, accessAnomalies: 0, maintenance: 0, coverage: 0, training: 0 };
  const week = isoWeek(now);
  for (const a of (await payerAlerts(db, practiceId, now)).filter((x) => x.severity === "high")) {
    await notify(db, practiceId, { kind: "payer_alert", title: `${a.payerName}: ${a.title}`, body: a.detail, href: "/reports/payer-alerts", dedupeKey: `payer:${a.payerId}:${a.kind}:${week}` });
    out.payerAlerts++;
  }
  const today = now.toISOString().slice(0, 10);
  for (const { c, first, last } of await listCredentials(db, practiceId)) {
    const state = credentialState(c.expiresOn, today);
    if (state === "ok") continue;
    await notify(db, practiceId, {
      kind: "credential", title: `${CREDENTIAL_KINDS[c.kind] ?? c.kind} for Dr. ${first} ${last} ${state === "expired" ? "has expired" : `expires ${c.expiresOn}`}`,
      body: state === "expired" ? "Claims for this provider may be denied until it is renewed." : "Renew it before it lapses to avoid payer enrollment problems.",
      href: "/settings/credentials", dedupeKey: `cred:${c.id}:${c.expiresOn}:${state}`,
    });
    out.credentials++;
  }
  out.accessAnomalies = await notifyAccessAnomalies(db, practiceId, now);
  const [last] = await db.select({ at: schema.accessReviews.createdAt }).from(schema.accessReviews).where(eq(schema.accessReviews.practiceId, practiceId)).orderBy(desc(schema.accessReviews.createdAt)).limit(1);
  if (!last || now.getTime() - last.at.getTime() > 90 * 86_400_000) {
    const q = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
    await notify(db, practiceId, { kind: "access_review", title: "Quarterly access review is due", body: last ? "The last review was more than 90 days ago. Confirm who still needs access and remove anyone who does not." : "No access review is on record. Confirm who needs access and remove anyone who does not.", href: "/settings/compliance", dedupeKey: `access-review:${q}` });
    out.accessReview = true;
  }
  // Setup that goes out of date on its own (server/maintenance.ts). Credentials and contracts notify on their own above
  // and in the contract reminders; the rest notify here, at most once a month for the same finding.
  const month = today.slice(0, 7);
  for (const item of await practiceMaintenance(db, practiceId, now)) {
    if (item.status === "ok" || item.key === "credentials" || item.key === "contracts") continue;
    await notify(db, practiceId, { kind: "maintenance", title: `${item.label}: ${item.status === "attention" ? "needs attention" : "coming up"}`, body: item.detail, href: item.href, dedupeKey: `maint:${item.key}:${item.status}:${month}` });
    out.maintenance++;
  }
  // Shift coverage (server/shifts.ts): a queue with everyone off, or tasks due by tomorrow whose owner is off.
  const gaps = await coverageGaps(db, practiceId, now);
  for (const q of gaps.uncovered) {
    await notify(db, practiceId, { kind: "coverage", title: `Nobody is available for the "${q.name}" queue today`, body: "Everyone on this rule is off. New tasks still go to them; add someone to the rule or reassign the work.", href: "/work/shifts", dedupeKey: `coverage:rule:${q.ruleId}:${today}` });
    out.coverage++;
  }
  if (gaps.stranded.length) {
    await notify(db, practiceId, { kind: "coverage", title: `${gaps.stranded.length} task${gaps.stranded.length === 1 ? "" : "s"} due by tomorrow belong to someone who is off`, body: gaps.stranded.slice(0, 5).map((s) => `${s.title} (${s.owner})`).join("\n"), href: "/tasks", dedupeKey: `coverage:tasks:${today}` });
    out.coverage++;
  }
  // Staff training and certifications coming up for renewal, expired, or HIPAA training missing (server/staff-training.ts).
  out.training = await trainingReminders(db, practiceId, now);
  return out;
}
