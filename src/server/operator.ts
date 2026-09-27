/**
 * The platform operator's view of every practice: who signed up, where each
 * trial stands, what they pay, and whether they are actually using it. Only
 * counts and dates; no patient information.
 */
import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { TIERS } from "@/content/pricing";
import { standing } from "./subscription";

const { practices, auditLog } = schema;

export type PracticeRow = {
  id: string; name: string; createdAt: Date; selfServe: boolean; plan: string | null; status: string; blocked: boolean;
  trialEndsAt: Date | null; seats: number | null; providers: number; users: number; claims30: number; lastLogin: Date | null;
  monthlyCents: number | null; closingAt: Date | null;
};

export async function practiceOverview(db: Db, now = new Date()): Promise<{ rows: PracticeRow[]; totals: Record<string, number> }> {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const { rows } = await db.execute(sql`
    SELECT p.*,
      (SELECT count(*)::int FROM providers v WHERE v.practice_id = p.id AND v.active) AS provider_count,
      (SELECT count(*)::int FROM users u WHERE u.practice_id = p.id AND u.disabled_at IS NULL) AS user_count,
      (SELECT count(*)::int FROM claims c WHERE c.practice_id = p.id AND c.submitted_at >= ${since}) AS claims30,
      (SELECT max(a.at) FROM audit_log a WHERE a.practice_id = p.id AND a.action = 'login') AS last_login
    FROM practices p ORDER BY p.created_at DESC`);
  const price = new Map(TIERS.map((t) => [t.id, t.priceMonthly]));
  const out: PracticeRow[] = (rows as Record<string, unknown>[]).map((r) => {
    const d = (v: unknown) => (v ? new Date(v as string) : null);
    const st = standing({ selfServe: !!r.self_serve, subscriptionStatus: String(r.subscription_status), trialEndsAt: d(r.trial_ends_at), plan: (r.plan as string) ?? null, stripeSubscriptionId: (r.stripe_subscription_id as string) ?? null, pastDueSince: d(r.past_due_since) }, now);
    const paying = !!r.stripe_subscription_id && ["active", "past_due"].includes(String(r.subscription_status));
    const perSeat = r.plan ? price.get(String(r.plan)) ?? null : null;
    return {
      id: String(r.id), name: String(r.name), createdAt: new Date(r.created_at as string), selfServe: !!r.self_serve, plan: (r.plan as string) ?? null,
      status: st.status, blocked: st.blocked, trialEndsAt: d(r.trial_ends_at), seats: (r.seats as number) ?? null,
      providers: Number(r.provider_count), users: Number(r.user_count), claims30: Number(r.claims30), lastLogin: d(r.last_login),
      monthlyCents: paying && perSeat ? perSeat * 100 * Number(r.seats ?? 1) : null, closingAt: d(r.closing_at),
    };
  });
  const totals = {
    practices: out.length,
    selfServe: out.filter((r) => r.selfServe).length,
    trialing: out.filter((r) => r.selfServe && r.status === "trialing").length,
    paying: out.filter((r) => r.monthlyCents !== null).length,
    blocked: out.filter((r) => r.blocked).length,
    monthlyCents: out.reduce((a, r) => a + (r.monthlyCents ?? 0), 0),
    claims30: out.reduce((a, r) => a + r.claims30, 0),
  };
  return { rows: out, totals };
}

/** Gives a self-serve practice more trial time (from today or the current end, whichever is later). */
export async function extendTrial(db: Db, practiceId: string, days: number, operatorEmail: string, now = new Date()) {
  if (!(days >= 1 && days <= 60)) throw new Error("Extend by 1 to 60 days");
  const [p] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  if (!p?.selfServe) throw new Error("Only self-serve practices have trials");
  const from = p.trialEndsAt && p.trialEndsAt > now ? p.trialEndsAt : now;
  const until = new Date(from.getTime() + days * 86_400_000);
  await db.update(practices).set({ trialEndsAt: until, subscriptionStatus: p.stripeSubscriptionId ? p.subscriptionStatus : "trialing" }).where(eq(practices.id, practiceId));
  await db.insert(auditLog).values({ practiceId, action: "trial_extended", entity: "practice", entityId: practiceId, details: { days, until: until.toISOString(), by: operatorEmail } });
  return until;
}
