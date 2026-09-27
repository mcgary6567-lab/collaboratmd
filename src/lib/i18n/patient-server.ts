import "server-only";
import { cookies } from "next/headers";
import { isLang, LANG_COOKIE, PATIENT_TEXT, type Lang } from "./patient";

/** The language a patient chose, falling back to English. */
export async function patientLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : "en";
}

export async function patientText() {
  const lang = await patientLang();
  return { lang, t: PATIENT_TEXT[lang] };
}

/** The language the patient picked with the switch, or null if they never did (the default is not a choice). */
export async function chosenLang(): Promise<Lang | null> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : null;
}
