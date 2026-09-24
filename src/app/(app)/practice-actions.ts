"use server";

import { redirect } from "next/navigation";
import { switchPractice } from "@/lib/auth";

export async function switchPracticeAction(formData: FormData): Promise<void> {
  await switchPractice(String(formData.get("practiceId") ?? ""));
  redirect("/dashboard");
}
