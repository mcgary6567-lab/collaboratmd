"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isLang, LANG_COOKIE } from "@/lib/i18n/patient";

/** Switches the patient pages' language and returns to the same page. Only same-site paths are accepted. */
export async function setPatientLangAction(lang: string, path: string) {
  if (!isLang(lang)) return;
  (await cookies()).set(LANG_COOKIE, lang, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 });
  const safe = /^\/(check-in|portal)\/[A-Za-z0-9_-]+$/.test(path) ? path : "/";
  redirect(safe);
}
