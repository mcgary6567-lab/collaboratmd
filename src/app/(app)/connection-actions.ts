"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { accessiblePractices, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { disconnectIntegration, practiceConfig, PROVIDERS, saveIntegration, testIntegration, type Provider } from "@/server/integrations";
import { sendEmail } from "@/server/notify";
import { sendSms, toE164 } from "@/server/messaging";

const PATH = "/settings/connections";
const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });
const known = (p: string): p is Provider => p in PROVIDERS;

export async function saveConnectionAction(provider: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  if (!known(provider)) return { ok: false, message: "Unknown service" };
  const def = PROVIDERS[provider];
  const input = {
    enabled: formData.get("enabled") === "on",
    secrets: Object.fromEntries(def.secrets.map((f) => [f.key, String(formData.get(`secret_${f.key}`) ?? "")])),
    settings: Object.fromEntries(def.settings.map((f) => [f.key, f.kind === "boolean" ? formData.get(`setting_${f.key}`) === "on" : String(formData.get(`setting_${f.key}`) ?? "")])),
  };
  try {
    const db = await getDb();
    // A billing company can apply one connection to every practice it administers.
    const targets = formData.get("allPractices") === "on"
      ? (await accessiblePractices(db, s.userId)).filter((p) => p.role === "admin").map((p) => p.id)
      : [s.practiceId];
    for (const practiceId of targets) await saveIntegration(db, practiceId, provider, input, s.userId);
    revalidatePath(PATH);
    const where = targets.length > 1 ? ` for ${targets.length} practices` : "";
    if (!input.enabled) return { ok: true, message: `${def.name} switched off${where}` };
    const test = await testIntegration(db, s.practiceId, provider, s.userId);
    revalidatePath(PATH);
    return { ok: test.ok, message: `Saved${where}. ${test.message}` };
  } catch (e) {
    return fail(e);
  }
}

export async function testConnectionAction(provider: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  if (!known(provider)) return { ok: false, message: "Unknown service" };
  const r = await testIntegration(await getDb(), s.practiceId, provider, s.userId);
  revalidatePath(PATH);
  return r;
}

export async function disconnectConnectionAction(provider: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  if (!known(provider)) return { ok: false, message: "Unknown service" };
  await disconnectIntegration(await getDb(), s.practiceId, provider, s.userId);
  revalidatePath(PATH);
  return { ok: true, message: `${PROVIDERS[provider].name} keys removed from this practice` };
}

/** Sends a test email to the signed-in admin, so the sender address is proven end to end. */
export async function testEmailAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const cfg = await practiceConfig(await getDb(), s.practiceId);
  if (!cfg.resend) return { ok: false, message: "Connect Resend first" };
  const ok = await sendEmail(s.email, "CollaboratMD test email", "This is a test from Settings → Integrations. Email delivery is working.", undefined, cfg.resend);
  return ok ? { ok: true, message: `Test email sent to ${s.email}` } : { ok: false, message: "Resend refused the message; check the sender address is on a verified domain" };
}

/** Sends a test text to a number the admin types, normally their own phone. */
export async function testSmsAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  const to = toE164(String(formData.get("to") ?? ""));
  if (!to) return { ok: false, message: "Enter a US mobile number" };
  const cfg = await practiceConfig(await getDb(), s.practiceId);
  if (!cfg.twilio) return { ok: false, message: "Connect Twilio first" };
  const r = await sendSms(cfg.twilio, to, "CollaboratMD test message: texting is working.");
  return r.ok ? { ok: true, message: `Test text sent to ${to}` } : { ok: false, message: r.detail };
}
