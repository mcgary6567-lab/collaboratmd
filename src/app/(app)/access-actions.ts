"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { clientIp } from "@/lib/ip";
import { siteOrigin } from "@/lib/origin";
import type { FormResult } from "@/components/action-form";
import type { RevealResult } from "@/app/(app)/developer-actions";
import {
  deleteCustomRole, inviteMember, newInviteLink, saveCustomRole, setIpAllowlist, setMemberActive, setMemberRole, setSessionHours,
} from "@/server/team";
import { discover, getSso, removeSso, rotateScimToken, saveSso } from "@/server/sso";

const admin = () => requireRole(["admin"]);
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const inviteUrl = async (token: string) => `${await siteOrigin()}/welcome?token=${encodeURIComponent(token)}`;

export async function inviteAction(_prev: RevealResult, formData: FormData): Promise<RevealResult> {
  const s = await admin();
  try {
    const r = await inviteMember(await getDb(), s.practiceId, { name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? ""), role: String(formData.get("role") ?? "") }, s.userId);
    revalidatePath("/settings/team");
    return r.token
      ? { ok: true, message: "Account created. Send them this link to choose a password; it works once, for 7 days.", secret: await inviteUrl(r.token) }
      : { ok: true, message: "They already had an account, so they now have access to this practice too. They sign in as usual." };
  } catch (e) {
    return fail(e, "Could not add them");
  }
}

export async function inviteLinkAction(userId: string, _prev: RevealResult): Promise<RevealResult> {
  const s = await admin();
  try {
    return { ok: true, message: "A new one-time link (any earlier unused link still works until a password is set):", secret: await inviteUrl(await newInviteLink(await getDb(), s.practiceId, userId)) };
  } catch (e) {
    return fail(e, "Could not make a link");
  }
}

export async function setRoleAction(userId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await admin();
  try {
    await setMemberRole(await getDb(), s.practiceId, userId, String(formData.get("role") ?? ""), s.userId);
    revalidatePath("/settings/team");
    return { ok: true, message: "Role changed; it applies on their next click" };
  } catch (e) {
    return fail(e, "Could not change the role");
  }
}

export async function setActiveAction(userId: string, active: boolean, _prev: FormResult): Promise<FormResult> {
  const s = await admin();
  try {
    await setMemberActive(await getDb(), s.practiceId, userId, active, s.userId);
    revalidatePath("/settings/team");
    return { ok: true, message: active ? "Reactivated" : "Access removed; they are signed out now" };
  } catch (e) {
    return fail(e, "Could not change access");
  }
}

export async function saveRoleAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await admin();
  try {
    await saveCustomRole(await getDb(), s.practiceId, { name: String(formData.get("name") ?? ""), baseRole: String(formData.get("baseRole") ?? ""), denied: formData.getAll("denied").map(String) }, s.userId);
    revalidatePath("/settings/team");
    return { ok: true, message: "Role saved" };
  } catch (e) {
    return fail(e, "Could not save the role");
  }
}

export async function deleteRoleAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await admin();
  try {
    await deleteCustomRole(await getDb(), s.practiceId, id, s.userId);
    revalidatePath("/settings/team");
    return { ok: true, message: "Role deleted" };
  } catch (e) {
    return fail(e, "Could not delete the role");
  }
}

export async function sessionHoursAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await admin();
  try {
    await setSessionHours(await getDb(), s.practiceId, Number(formData.get("hours")), s.userId);
    revalidatePath("/settings/security");
    return { ok: true, message: "Saved. It applies to every session, counted from each person's sign-in." };
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function ipAllowlistAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await admin();
  try {
    const list = await setIpAllowlist(await getDb(), s.practiceId, String(formData.get("allowlist") ?? ""), clientIp(await headers()), s.userId);
    revalidatePath("/settings/security");
    return { ok: true, message: list.length ? `Sign-in now allowed only from ${list.length} network${list.length === 1 ? "" : "s"}` : "Sign-in allowed from anywhere" };
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function saveSsoAction(_prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await admin();
  const f = (k: string) => String(formData.get(k) ?? "");
  const enforce = formData.get("enforce") === "on";
  const ownDomain = s.email.split("@")[1]?.toLowerCase() ?? "";
  if (enforce && !s.sso && f("domains").toLowerCase().split(/[\s,]+/).map((d) => d.replace(/^@/, "")).includes(ownDomain)) {
    return { ok: false, message: "Sign in with SSO once yourself before requiring it, so a setup mistake cannot lock you out. Save without \"Require SSO\" first." };
  }
  try {
    await saveSso(await getDb(), s.practiceId, {
      protocol: f("protocol") === "saml" ? "saml" : "oidc",
      issuer: f("issuer"), clientId: f("clientId"), clientSecret: f("clientSecret"),
      samlEntryPoint: f("samlEntryPoint"), samlIdpIssuer: f("samlIdpIssuer"), samlIdpCert: String(formData.get("samlIdpCert") ?? ""),
      domains: f("domains"), enforce, autoProvision: formData.get("autoProvision") === "on", defaultRole: f("defaultRole"),
    }, s.userId);
    revalidatePath("/settings/sso");
    return { ok: true, message: "Saved. Test it, then try signing in with SSO in a private window before requiring it." };
  } catch (e) {
    return fail(e, "Could not save");
  }
}

export async function testSsoAction(_prev: FormResult): Promise<FormResult> {
  const s = await admin();
  const cfg = await getSso(await getDb(), s.practiceId);
  if (!cfg) return { ok: false, message: "Save the settings first" };
  if (cfg.protocol !== "oidc" || !cfg.issuer) return { ok: true, message: "SAML: the identity provider's certificate and sign-in URL are checked at the first real sign-in." };
  try {
    const doc = await discover(cfg.issuer);
    return { ok: true, message: `Found the provider: sign-in at ${new URL(doc.authorization_endpoint).host}, keys at ${new URL(doc.jwks_uri).host}. The client secret is only checked at the first real sign-in.` };
  } catch (e) {
    return fail(e, "Could not reach the provider");
  }
}

export async function removeSsoAction(_prev: FormResult): Promise<FormResult> {
  const s = await admin();
  await removeSso(await getDb(), s.practiceId, s.userId);
  revalidatePath("/settings/sso");
  return { ok: true, message: "Single sign-on removed; everyone signs in with a password again" };
}

export async function rotateScimAction(_prev: RevealResult): Promise<RevealResult> {
  const s = await admin();
  try {
    const token = await rotateScimToken(await getDb(), s.practiceId, s.userId);
    revalidatePath("/settings/sso");
    return { ok: true, message: "Copy this token into your identity provider now; it is not shown again. Any earlier token stopped working.", secret: token };
  } catch (e) {
    return fail(e, "Could not create a token");
  }
}
