/**
 * Who must sign in with two-factor. A practice can require it of everyone
 * (requireMfa), or of the accounts where a stolen password does the most harm
 * (mfaForPrivileged): administrators, and anyone whose role can export data.
 * New self-serve practices start with the second on.
 *
 * People who sign in with single sign-on prove a second factor at their
 * identity provider, so this does not ask them again.
 */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { allows } from "@/lib/capabilities";

const { practices, users } = schema;

export function privileged(role: string, denied: string[] = []) {
  return role === "admin" || allows(role, denied, "export");
}

export type MfaRule = { required: boolean; why: "everyone" | "privileged" | null; enrolled: boolean; mustEnroll: boolean };

export async function mfaRule(db: Db, who: { userId: string; practiceId: string; role: string; denied?: string[]; sso?: boolean }): Promise<MfaRule> {
  const [[p], [u]] = await Promise.all([
    db.select({ requireMfa: practices.requireMfa, mfaForPrivileged: practices.mfaForPrivileged }).from(practices).where(eq(practices.id, who.practiceId)).limit(1),
    db.select({ mfaSecret: users.mfaSecret }).from(users).where(eq(users.id, who.userId)).limit(1),
  ]);
  const why = p?.requireMfa ? "everyone" : p?.mfaForPrivileged && privileged(who.role, who.denied) ? "privileged" : null;
  const enrolled = !!u?.mfaSecret;
  return { required: !!why, why, enrolled, mustEnroll: !!why && !enrolled && !who.sso };
}

/** For export routes: the response to send when this person must set up two-factor first, or null. */
export async function mfaRefusal(db: Db, who: Parameters<typeof mfaRule>[1]) {
  const rule = await mfaRule(db, who);
  return rule.mustEnroll ? new Response("Set up two-factor sign-in first (Settings > Sign-in security): your practice requires it for anyone who can export", { status: 403 }) : null;
}
