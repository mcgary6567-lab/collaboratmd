"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { completeMfaLogin, login, logout } from "@/lib/auth";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const r = await login(parsed.data.email, parsed.data.password);
  if ("mfa" in r) redirect("/login/verify");
  if (!r.ok) return { error: r.error };
  redirect("/dashboard");
}

export async function verifyMfaAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const r = await completeMfaLogin(String(formData.get("code") ?? ""));
  if (!r.ok) return { error: "error" in r ? r.error : "Sign-in failed" };
  redirect("/dashboard");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
