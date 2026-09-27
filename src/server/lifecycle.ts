/**
 * Account emails to self-serve practices, each sent once: a welcome, a nudge
 * when setup has stalled, a warning before the trial ends, a note when it has
 * ended, and a warning when a payment fails. They go to the practice's
 * administrators through the deployment's email (RESEND_API_KEY), carry no
 * patient information, and are not sent when email is not configured.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { standing, GRACE_DAYS } from "./subscription";

const { practices, users, providers, lifecycleEmails } = schema;
type Send = (to: string, subject: string, text: string) => Promise<boolean>;
type Practice = typeof practices.$inferSelect;
const DAY = 86_400_000;

async function recipients(db: Db, p: Practice) {
  const admins = await db.select({ email: users.email }).from(users).where(and(eq(users.practiceId, p.id), eq(users.role, "admin"), isNull(users.disabledAt)));
  return [...new Set([...admins.map((a) => a.email.toLowerCase()), ...(p.billingEmail ? [p.billingEmail.toLowerCase()] : [])])];
}

/** Claims the kind for this practice, so two runs never send it twice. */
async function once(db: Db, practiceId: string, kind: string, now: Date) {
  const r = await db.insert(lifecycleEmails).values({ practiceId, kind, sentAt: now }).onConflictDoNothing().returning();
  return r.length > 0;
}

async function deliver(db: Db, p: Practice, kind: string, subject: string, text: string, send: Send, now: Date) {
  const to = await recipients(db, p);
  if (!to.length || !(await once(db, p.id, kind, now))) return false;
  const results = await Promise.all(to.map((e) => send(e, subject, text)));
  // Nothing delivered (email not configured): release the claim so a later run can try.
  if (!results.some(Boolean)) await db.delete(lifecycleEmails).where(and(eq(lifecycleEmails.practiceId, p.id), eq(lifecycleEmails.kind, kind)));
  return results.some(Boolean);
}

export async function sendWelcome(db: Db, practiceId: string, origin: string, send: Send, now = new Date()) {
  const [p] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  if (!p) return false;
  const st = standing(p, now);
  return deliver(db, p, "welcome", `Welcome to CollaboratMD, ${p.name}`,
    `Your practice is set up${st.trialDaysLeft !== null ? ` and your ${st.trialDaysLeft}-day trial has started` : ""}.\n\nThe setup guide on your dashboard walks through what claims need first: the practice NPI, tax ID and address, your providers, and a clearinghouse connection.\n\nSign in: ${origin}/login\n\nUse test data until your business associate agreement with us is signed. Reply to this email with any question.`,
    send, now);
}

/** Daily: whichever emails are due for each self-serve practice. Returns how many went out. */
export async function sendLifecycleEmails(db: Db, origin: string, send: Send, now = new Date()) {
  const rows = await db.select().from(practices).where(and(eq(practices.selfServe, true), isNull(practices.closingAt)));
  let sent = 0;
  for (const p of rows) {
    const st = standing(p, now);
    const subscribed = !!p.stripeSubscriptionId && ["active", "trialing", "past_due"].includes(p.subscriptionStatus);
    const plan = `${origin}/settings/subscription`;

    if (!subscribed && p.createdAt.getTime() <= now.getTime() - 3 * DAY) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(providers).where(and(eq(providers.practiceId, p.id), eq(providers.active, true)));
      const missing = [!p.npi && "the practice NPI", !p.taxId && "the tax ID", !p.address1 && "the practice address", !p.phone && "the phone number", Number(n) === 0 && "at least one provider"].filter(Boolean) as string[];
      if (missing.length && (await deliver(db, p, "setup_nudge", `A few things left before ${p.name} can send claims`,
        `Claims can't go out until these are filled in: ${missing.join(", ")}.\n\nThe setup guide on your dashboard takes you to each one: ${origin}/dashboard\n\nStuck on something? Reply to this email.`, send, now))) sent++;
    }
    if (!subscribed && st.trialDaysLeft !== null && st.trialDaysLeft > 0 && st.trialDaysLeft <= 3 && (await deliver(db, p, "trial_ending", `Your CollaboratMD trial ends in ${st.trialDaysLeft} day${st.trialDaysLeft === 1 ? "" : "s"}`,
      `The free trial for ${p.name} ends on ${p.trialEndsAt!.toUTCString().slice(0, 16)}. After that, claims stop going out until someone subscribes; your data stays and can be exported at any time.\n\nChoose a plan: ${plan}`, send, now))) sent++;
    if (!subscribed && st.blocked && st.status === "trial_ended" && (await deliver(db, p, "trial_ended", `Your CollaboratMD trial has ended`,
      `The free trial for ${p.name} has ended, so claims are paused. Everything else keeps working, including the data export.\n\nSubscribe to send claims again: ${plan}`, send, now))) sent++;
    if (p.subscriptionStatus === "past_due" && p.pastDueSince) {
      const until = new Date(p.pastDueSince.getTime() + GRACE_DAYS * DAY);
      if (await deliver(db, p, `past_due:${p.pastDueSince.toISOString().slice(0, 10)}`, "A CollaboratMD payment failed",
        `The latest payment for ${p.name} did not go through. Claims keep going out until ${until.toUTCString().slice(0, 16)}; after that they pause until the payment method is updated.\n\nUpdate it here: ${plan}`, send, now)) sent++;
    }
  }
  return sent;
}
