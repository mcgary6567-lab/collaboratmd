/**
 * Suggestions for administrators: useful screens nobody in the practice has
 * opened in the last 60 days, from the usage counts. Shown once a practice has
 * been live for two weeks (before that the setup guide leads), at most three
 * at a time, and each can be dismissed for good.
 */
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { featureUsage, dismissedTips, practices } = schema;

export type Tip = { key: string; title: string; why: string; href: string };

/** In order of how much they usually matter to a billing office. `key` is the usage pattern of the screen. */
export const TIPS: Tip[] = [
  { key: "claims/follow-up", title: "Claim follow-up", why: "Claims accepted more than 30 days ago and still unpaid, with what the payer said when asked.", href: "/claims/follow-up" },
  { key: "denials/agent", title: "Denial agent", why: "Works open denials overnight and has each one prepared for your approval in the morning.", href: "/denials/agent" },
  { key: "billing/missed-charges", title: "Missed charges", why: "Visits from the last 60 days that were seen but never billed.", href: "/billing/missed-charges" },
  { key: "underpayments", title: "Underpayments", why: "Paid claims whose allowed amount fell short of the payer contract, with a letter to the payer.", href: "/underpayments" },
  { key: "settings/automation", title: "Automation", why: "Reminders, statements and follow-ups that run every morning without anyone starting them.", href: "/settings/automation" },
  { key: "patients/coverage-discovery", title: "Coverage discovery", why: "Patients with no insurance on file, soonest visit first, to find coverage they may not have mentioned.", href: "/patients/coverage-discovery" },
  { key: "reports/forecast", title: "Cash forecast", why: "What is expected to be paid in the coming weeks, from each payer's history.", href: "/reports/forecast" },
  { key: "settings/booking", title: "Online booking", why: "A link patients use to request open times; the front desk confirms each request.", href: "/settings/booking" },
  { key: "work", title: "Work queues", why: "Rules that hand out denials and stuck claims as tasks, with due dates, and how the team is keeping up.", href: "/work" },
  { key: "reports/builder", title: "Report builder", why: "Your own reports: choose the data and grouping, save them, and have them emailed on a schedule.", href: "/reports/builder" },
];
export const LIVE_DAYS = 14;
export const LOOKBACK_DAYS = 60;

export async function featureTips(db: Db, practiceId: string, now = new Date(), max = 3): Promise<Tip[]> {
  const [p] = await db.select({ createdAt: practices.createdAt }).from(practices).where(eq(practices.id, practiceId)).limit(1);
  if (!p || now.getTime() - p.createdAt.getTime() < LIVE_DAYS * 86_400_000) return [];
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const [used, dismissed] = await Promise.all([
    db.selectDistinct({ feature: featureUsage.feature }).from(featureUsage).where(and(eq(featureUsage.practiceId, practiceId), gte(featureUsage.day, since))),
    db.select({ tip: dismissedTips.tip }).from(dismissedTips).where(eq(dismissedTips.practiceId, practiceId)),
  ]);
  // No usage recorded at all means the counts are not available yet (for example just after they were turned on): suggest nothing rather than everything.
  if (!used.length) return [];
  const skip = new Set([...used.map((u) => u.feature), ...dismissed.map((d) => d.tip)]);
  return TIPS.filter((t) => !skip.has(t.key)).slice(0, max);
}

export async function dismissTip(db: Db, practiceId: string, tip: string, userId: string) {
  if (!TIPS.some((t) => t.key === tip)) throw new Error("Unknown suggestion");
  await db.insert(dismissedTips).values({ practiceId, tip, dismissedBy: userId }).onConflictDoNothing();
}
