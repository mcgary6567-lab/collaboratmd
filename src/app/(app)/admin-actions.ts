"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { renewSession, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { revokeAllSessions, revokeUserSessions, saveProfile, savePayer, saveProvider, setHiddenNav, setProviderActive } from "@/server/admin";
import { adjustSmallBalances, savePolicies } from "@/server/policies";
import { requestReset } from "@/server/password-reset";
import { listTeam } from "@/server/team";
import { deleteCredential, saveCredential } from "@/server/credentials";
import { siteOrigin } from "@/lib/origin";

const admin = () => requireRole(["admin"]);
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const f = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
/** "" means not set; otherwise dollars to cents. */
const centsOrNull = (v: string) => (v === "" ? null : Math.round(Number(v.replace(/[$,\s]/g, "")) * 100));

export async function saveProfileAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await admin();
  try {
    await saveProfile(await getDb(), s.practiceId, { name: f(fd, "name"), npi: f(fd, "npi"), taxId: f(fd, "taxId"), address1: f(fd, "address1"), city: f(fd, "city"), state: f(fd, "state"), zip: f(fd, "zip"), phone: f(fd, "phone") }, s.userId);
    revalidatePath("/settings", "layout");
    return { ok: true, message: "Saved. Claims sent from now on carry these details." };
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function saveProviderAction(id: string | null, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await admin();
  try {
    await saveProvider(await getDb(), s.practiceId, id, { firstName: f(fd, "firstName"), lastName: f(fd, "lastName"), npi: f(fd, "npi"), taxonomy: f(fd, "taxonomy"), specialty: f(fd, "specialty") }, s.userId);
    revalidatePath("/settings/providers");
    return { ok: true, message: id ? "Provider updated" : "Provider added" };
  } catch (e) {
    return fail(e, "Could not save the provider");
  }
}

export async function providerActiveAction(id: string, active: boolean, _prev: FormResult): Promise<FormResult> {
  const s = await admin();
  try {
    await setProviderActive(await getDb(), s.practiceId, id, active, s.userId);
    revalidatePath("/settings/providers");
    return { ok: true, message: active ? "Active again" : "Deactivated; history is kept" };
  } catch (e) {
    return fail(e, "Could not change the provider");
  }
}

export async function savePayerAction(id: string | null, _prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await admin();
  try {
    await savePayer(await getDb(), s.practiceId, id, { name: f(fd, "name"), payerId: f(fd, "payerId"), type: f(fd, "type"), timelyFilingDays: Number(f(fd, "timelyFilingDays")), appealDays: Number(f(fd, "appealDays")) }, s.userId);
    revalidatePath("/settings/payers");
    return { ok: true, message: id ? "Payer updated" : "Payer added" };
  } catch (e) {
    return fail(e, "Could not save the payer");
  }
}

export async function savePoliciesAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await admin();
  try {
    await savePolicies(await getDb(), s.practiceId, {
      writeOffLimitCents: fd.get("writeOffLimitOn") === "on" ? centsOrNull(f(fd, "writeOffLimit")) ?? 0 : null,
      strictScrub: fd.get("strictScrub") === "on",
      riskHoldScore: fd.get("riskHoldOn") === "on" ? Number(f(fd, "riskHoldScore")) : null,
      statementMinCents: centsOrNull(f(fd, "statementMin")) ?? 500,
      statementIntervalDays: Number(f(fd, "statementIntervalDays")),
      smallBalanceCents: fd.get("smallBalanceOn") === "on" ? centsOrNull(f(fd, "smallBalance")) ?? 0 : null,
      smallBalanceAgeDays: Number(f(fd, "smallBalanceAgeDays")),
      exportsAdminOnly: fd.get("exportsAdminOnly") === "on",
      refundDualControl: fd.get("refundDualControl") === "on",
    }, s.userId);
    revalidatePath("/settings/policies");
    return { ok: true, message: "Policies saved; they apply immediately" };
  } catch (e) {
    return fail(e, "Could not save the policies");
  }
}

export async function runSmallBalancesAction(_prev: FormResult): Promise<FormResult> {
  const s = await admin();
  const r = await adjustSmallBalances(await getDb(), s.practiceId, { userId: s.userId });
  revalidatePath("/settings/policies");
  return { ok: true, message: r.adjusted ? `Adjusted ${r.adjusted} small balance${r.adjusted === 1 ? "" : "s"}, $${(r.cents / 100).toFixed(2)} in total` : "No balances qualify right now" };
}

export async function saveMenuAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await admin();
  const shown = new Set(fd.getAll("show").map(String));
  const all = fd.getAll("all").map(String);
  const hidden = await setHiddenNav(await getDb(), s.practiceId, all.filter((h) => !shown.has(h)), s.userId);
  revalidatePath("/", "layout");
  return { ok: true, message: hidden.length ? `${hidden.length} item${hidden.length === 1 ? "" : "s"} hidden from the menu for everyone` : "Every item is shown" };
}

export async function signOutEveryoneAction(_prev: FormResult): Promise<FormResult> {
  const s = await admin();
  await revokeAllSessions(await getDb(), s.practiceId, s.userId);
  await renewSession();
  return { ok: true, message: "Everyone else is signed out; they must sign in again. You stay signed in." };
}

export async function signOutUserAction(userId: string, _prev: FormResult): Promise<FormResult> {
  const s = await admin();
  if (userId === s.userId) return { ok: false, message: "Use Sign out in the menu for yourself" };
  await revokeUserSessions(await getDb(), s.practiceId, userId, s.userId);
  return { ok: true, message: "Signed out on every device" };
}

/** Emails the person a reset link; the administrator never sees it. */
export async function sendResetAction(userId: string, _prev: FormResult): Promise<FormResult> {
  const s = await admin();
  const db = await getDb();
  const member = (await listTeam(db, s.practiceId)).find((m) => m.userId === userId);
  if (!member) return { ok: false, message: "Not on this practice's team" };
  const r = await requestReset(db, member.email, await siteOrigin(), { requestedBy: s.userId });
  const messages: Record<typeof r, FormResult> = {
    sent: { ok: true, message: `Reset link emailed to ${member.email}` },
    no_email: { ok: false, message: "Email is not connected (Settings, Integrations), so no link can be sent" },
    sso: { ok: false, message: "They sign in with single sign-on; reset their password at your identity provider" },
    throttled: { ok: false, message: "A link was sent in the last five minutes; ask them to check their inbox" },
    no_account: { ok: false, message: "That account is deactivated" },
    send_failed: { ok: false, message: "The email could not be sent; check the email connection" },
  };
  return messages[r];
}

export async function dismissOnboardingAction(_prev: FormResult): Promise<FormResult> {
  const s = await admin();
  await (await getDb()).update(schema.practices).set({ onboardingDismissedAt: new Date() }).where(eq(schema.practices.id, s.practiceId));
  revalidatePath("/dashboard");
  return { ok: true, message: "Hidden. Setup health stays on the Settings page." };
}

export async function saveCredentialAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin", "biller"]);
  try {
    await saveCredential(await getDb(), s.practiceId, { providerId: f(fd, "providerId"), kind: f(fd, "kind"), identifier: f(fd, "identifier"), state: f(fd, "state"), issuedOn: f(fd, "issuedOn"), expiresOn: f(fd, "expiresOn"), note: f(fd, "note") }, s.userId);
    revalidatePath("/settings/credentials");
    return { ok: true, message: "Saved; you will be reminded 60 days before it expires" };
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function deleteCredentialAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin", "biller"]);
  await deleteCredential(await getDb(), s.practiceId, id, s.userId);
  revalidatePath("/settings/credentials");
  return { ok: true, message: "Removed" };
}
