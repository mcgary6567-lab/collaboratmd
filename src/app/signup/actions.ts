"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { clientIp } from "@/lib/ip";
import { siteOrigin } from "@/lib/origin";
import { sendEmail } from "@/server/notify";
import { completeSignup, startSignup } from "@/server/signup";
import { sendWelcome } from "@/server/lifecycle";
import { hit, waitMessage } from "@/server/throttle";

export type SignupState = { done?: boolean; error?: string } | undefined;

export async function signupAction(_prev: SignupState, fd: FormData): Promise<SignupState> {
  // A hidden field people never see; bots fill it. Answer as if it worked.
  if (String(fd.get("website") ?? "")) return { done: true };
  if (fd.get("agree") !== "on") return { error: "Please agree to the terms to continue" };
  const db = await getDb();
  const t = await hit(db, "signup", clientIp(await headers()));
  if (!t.ok) return { error: waitMessage(t.retryAfterSec) };
  let delivered = true;
  try {
    await startSignup(db, {
      name: String(fd.get("name") ?? ""), email: String(fd.get("email") ?? ""), practiceName: String(fd.get("practiceName") ?? ""),
      password: String(fd.get("password") ?? ""), plan: String(fd.get("plan") ?? "") || null,
    }, await siteOrigin(), { send: async (to, subject, text) => (delivered = await sendEmail(to, subject, text)) });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not start the signup" };
  }
  if (!delivered) return { error: "We could not send the confirmation email just now. Please try again in a few minutes." };
  return { done: true };
}

export async function completeSignupAction(token: string, _prev: SignupState): Promise<SignupState> {
  try {
    const db = await getDb();
    const done = await completeSignup(db, token, new Date(), clientIp(await headers()));
    await sendWelcome(db, done.practiceId, await siteOrigin(), (to, subject, text) => sendEmail(to, subject, text)).catch(() => false);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not create the practice" };
  }
  redirect("/login?created=1");
}
