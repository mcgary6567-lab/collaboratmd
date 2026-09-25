"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { FormResult } from "@/components/action-form";
import { grantPortal, portalVerifiedFor } from "@/lib/portal-session";
import { siteOrigin } from "@/lib/origin";
import { openPortal, reportInsurance, startPortalPayment, verifyPortalDob } from "@/server/portal";

async function verifiedLink(token: string) {
  const db = await getDb();
  const o = await openPortal(db, token);
  if (o.state !== "open" || !(await portalVerifiedFor(o.link.id))) return null;
  return { db, link: o.link };
}

export async function verifyPortalAction(token: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const db = await getDb();
  const r = await verifyPortalDob(db, token, String(formData.get("dob") ?? ""));
  if (!r.ok) return { ok: false, message: r.message };
  await grantPortal(r.linkId);
  redirect(`/portal/${token}`);
}

export async function payAction(token: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const v = await verifiedLink(token);
  if (!v) return { ok: false, message: "Your session has ended. Reload the page and confirm your date of birth again." };
  let url: string;
  try {
    const amountCents = Math.round(parseFloat(String(formData.get("amount") ?? "0")) * 100);
    const planId = String(formData.get("planId") ?? "") || null;
    const r = await startPortalPayment(v.db, v.link.id, { amountCents, planId, autopay: formData.get("autopay") === "on", origin: await siteOrigin(), token });
    url = r.url;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
  redirect(url);
}

export async function reportInsuranceAction(token: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const v = await verifiedLink(token);
  if (!v) return { ok: false, message: "Your session has ended. Reload the page and confirm your date of birth again." };
  try {
    await reportInsurance(v.db, v.link.id, { payerName: String(formData.get("payerName") ?? ""), memberId: String(formData.get("memberId") ?? ""), groupNumber: String(formData.get("groupNumber") ?? "") });
    return { ok: true, message: "Thank you. The office will update your insurance before your next visit." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
}
