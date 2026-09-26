/**
 * Checks that run every morning and turn into notifications for the
 * administrators: payers behaving differently, credentials about to expire,
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
  const out = { payerAlerts: 0, credentials: 0, accessReview: false };
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
  const [last] = await db.select({ at: schema.accessReviews.createdAt }).from(schema.accessReviews).where(eq(schema.accessReviews.practiceId, practiceId)).orderBy(desc(schema.accessReviews.createdAt)).limit(1);
  if (!last || now.getTime() - last.at.getTime() > 90 * 86_400_000) {
    const q = `${now.getUTCFullYear()}-Q${Math.floor(now.getUTCMonth() / 3) + 1}`;
    await notify(db, practiceId, { kind: "access_review", title: "Quarterly access review is due", body: last ? "The last review was more than 90 days ago. Confirm who still needs access and remove anyone who does not." : "No access review is on record. Confirm who needs access and remove anyone who does not.", href: "/settings/compliance", dedupeKey: `access-review:${q}` });
    out.accessReview = true;
  }
  return out;
}
