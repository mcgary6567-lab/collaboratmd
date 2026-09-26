"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import type { FormResult } from "@/components/action-form";
import { billingPortalUrl, startSubscriptionCheckout } from "@/server/subscription";

export async function subscribeAction(_prev: FormResult, fd: FormData): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  let url: string;
  try {
    url = await startSubscriptionCheckout(await getDb(), s.practiceId, { plan: String(fd.get("plan") ?? ""), cycle: fd.get("cycle") === "annual" ? "annual" : "monthly", origin: await siteOrigin(), email: s.email }, { userId: s.userId });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not start checkout" };
  }
  redirect(url);
}

export async function billingPortalAction(_prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  let url: string;
  try {
    url = await billingPortalUrl(await getDb(), s.practiceId, await siteOrigin());
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not open billing" };
  }
  redirect(url);
}
