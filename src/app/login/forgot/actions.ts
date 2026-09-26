"use server";

import { getDb } from "@/db";
import { siteOrigin } from "@/lib/origin";
import { requestReset } from "@/server/password-reset";

/** Always the same answer, so the form cannot reveal who has an account. */
export async function requestResetAction(_prev: { done: boolean } | undefined, formData: FormData): Promise<{ done: boolean }> {
  const email = String(formData.get("email") ?? "").trim();
  if (email.includes("@")) {
    try {
      await requestReset(await getDb(), email, await siteOrigin());
    } catch (e) {
      console.error("password reset request failed", e instanceof Error ? e.message : e);
    }
  }
  return { done: true };
}
