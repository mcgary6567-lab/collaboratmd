"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { completeReset } from "@/server/password-reset";

export async function completeResetAction(token: string, _prev: { error: string } | undefined, formData: FormData): Promise<{ error: string } | undefined> {
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match" };
  try {
    await completeReset(await getDb(), token, password);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not reset the password" };
  }
  redirect("/login?reset=1");
}
