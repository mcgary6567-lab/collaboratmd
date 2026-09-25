"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { acceptInvite } from "@/server/team";

export async function acceptInviteAction(token: string, _prev: { error: string } | undefined, formData: FormData): Promise<{ error: string } | undefined> {
  const password = String(formData.get("password") ?? "");
  if (password !== String(formData.get("confirm") ?? "")) return { error: "The two passwords do not match" };
  try {
    await acceptInvite(await getDb(), token, password);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not set the password" };
  }
  redirect("/login?welcome=1");
}
