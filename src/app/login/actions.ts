"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { login, logout } from "@/lib/auth";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ email: formData.get("email"), password: formData.get("password") });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const session = await login(parsed.data.email, parsed.data.password);
  if (!session) return { error: "Invalid email or password." };
  redirect("/dashboard");
}

export async function logoutAction() {
  await logout();
  redirect("/login");
}
