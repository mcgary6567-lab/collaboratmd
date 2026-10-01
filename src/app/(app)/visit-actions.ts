"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { siteOrigin } from "@/lib/origin";
import { rescrubClaim } from "@/server/claims";
import { applySubstitute, saveArrangement } from "@/server/substitutes";
import { addReferral } from "@/server/referrals-in";
import { certifyPlan, recertify, savePlan } from "@/server/therapy-plans";
import { recordOtherCoverage } from "@/server/other-coverage";
import { notifyExpiringCards, sendCardUpdateLink } from "@/server/card-expiry";
import { logInterpreter, setInterpreterLanguage } from "@/server/interpreters";
import { schema } from "@/db";
import { and, eq } from "drizzle-orm";

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const cents = (v: string) => (v ? Math.round(Number(v.replace(/[$,\s]/g, "")) * 100) : null);
const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });
const done = (paths: string[], message: string): FormResult => { for (const p of paths) revalidatePath(p); return { ok: true, message }; };

/* Substitute physicians */

export async function saveArrangementAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(["admin", "biller"]);
    const r = await saveArrangement(await getDb(), s.practiceId, { absentProviderId: str(f, "providerId"), kind: str(f, "kind"), substituteName: str(f, "name"), substituteNpi: str(f, "npi"), startsOn: str(f, "startsOn"), endsOn: str(f, "endsOn"), notes: str(f, "notes") }, s.userId);
    return done(["/settings/substitutes"], r.overMedicareLimit ? "Saved. The absence is longer than 60 days: Medicare visits after day 60 must be billed under the substitute's own enrollment." : "Saved");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function applySubstituteAction(claimId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const db = await getDb();
    const id = str(f, "arrangementId");
    await applySubstitute(db, s.practiceId, claimId, id || null, s.userId);
    await rescrubClaim(db, claimId);
    return done([`/claims/${claimId}`], id ? "Marked as seen by the substitute; the modifier is on every line" : "Substitute removed");
  } catch (e) { return fail(e, "Could not save"); }
}

/* Referrals */

export async function addReferralAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const visits = str(f, "visits");
    await addReferral(await getDb(), s.practiceId, { patientId, payerId: str(f, "payerId"), referralNumber: str(f, "number"), referringName: str(f, "referringName"), referringNpi: str(f, "referringNpi"), visitsAllowed: visits ? Number(visits) : null, startsOn: str(f, "startsOn"), endsOn: str(f, "endsOn"), notes: str(f, "notes") }, s.userId);
    return done([`/patients/${patientId}`, "/scheduling/referrals"], "Referral saved; its number goes on the claims it covers");
  } catch (e) { return fail(e, "Could not save the referral"); }
}

/* Therapy plans of care */

export async function savePlanAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await savePlan(await getDb(), s.practiceId, { patientId, discipline: str(f, "discipline"), startsOn: str(f, "startsOn"), endsOn: str(f, "endsOn"), certifiedOn: str(f, "certifiedOn") || null, certifierName: str(f, "certifierName"), certifierNpi: str(f, "certifierNpi"), delayReason: str(f, "delayReason") }, s.userId);
    return done([`/patients/${patientId}`, "/coding/therapy-plans"], "Plan of care saved");
  } catch (e) { return fail(e, "Could not save the plan"); }
}

export async function certifyPlanAction(planId: string, patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await certifyPlan(await getDb(), s.practiceId, planId, { certifiedOn: str(f, "certifiedOn"), certifierName: str(f, "certifierName"), certifierNpi: str(f, "certifierNpi"), delayReason: str(f, "delayReason") }, s.userId);
    return done([`/patients/${patientId}`, "/coding/therapy-plans"], "Certification recorded");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function recertifyAction(planId: string, patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await recertify(await getDb(), s.practiceId, planId, str(f, "endsOn"), s.userId);
    return done([`/patients/${patientId}`, "/coding/therapy-plans"], "Next plan started; record the physician's signature when it comes back");
  } catch (e) { return fail(e, "Could not start the next plan"); }
}

/* Other insurance */

export async function otherCoverageAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const answer = str(f, "answer");
    await recordOtherCoverage(await getDb(), s.practiceId, patientId, { answer: answer as "yes" | "no", detail: str(f, "detail"), via: "staff" }, s.userId);
    return done([`/patients/${patientId}`, "/patients/other-coverage"], answer === "yes" ? "Recorded: add the other policy to the patient's insurance" : "Recorded");
  } catch (e) { return fail(e, "Could not save"); }
}

/* Expiring cards */

export async function sendCardLinkAction(cardId: string, _prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const r = await sendCardUpdateLink(await getDb(), s.practiceId, cardId, { origin: await siteOrigin(), userId: s.userId });
    revalidatePath("/billing/expiring-cards");
    return r.sms === "sent" || r.email === "sent" ? { ok: true, message: `Sent by ${[r.sms === "sent" && "text", r.email === "sent" && "email"].filter(Boolean).join(" and ")}` } : { ok: false, message: r.reason ?? "Not sent: the patient has no phone or email we can use" };
  } catch (e) { return fail(e, "Could not send"); }
}

export async function notifyCardsAction(_prev: FormResult): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const r = await notifyExpiringCards(await getDb(), s.practiceId, { origin: await siteOrigin(), userId: s.userId });
    revalidatePath("/billing/expiring-cards");
    return { ok: true, message: `${r.sent} sent, ${r.skipped} skipped (recently notified, or no phone or email)` };
  } catch (e) { return fail(e, "Could not send"); }
}

/* Interpreters */

export async function interpreterLanguageAction(patientId: string, _prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    await setInterpreterLanguage(await getDb(), s.practiceId, patientId, str(f, "language"), s.userId);
    return done([`/patients/${patientId}`], "Saved");
  } catch (e) { return fail(e, "Could not save"); }
}

export async function logInterpreterAction(_prev: FormResult, f: FormData): Promise<FormResult> {
  try {
    const s = await requireRole(CAN_WRITE);
    const db = await getDb();
    const [p] = await db.select({ id: schema.patients.id }).from(schema.patients).where(and(eq(schema.patients.practiceId, s.practiceId), eq(schema.patients.mrn, str(f, "mrn")))).limit(1);
    if (!p) return { ok: false, message: `No patient with MRN ${str(f, "mrn")}` };
    await logInterpreter(db, s.practiceId, { patientId: p.id, servedOn: str(f, "servedOn"), language: str(f, "language"), mode: str(f, "mode"), vendor: str(f, "vendor"), minutes: Number(str(f, "minutes") || 0), costCents: cents(str(f, "cost")), declined: f.get("declined") === "on", notes: str(f, "notes") }, s.userId);
    return done(["/interpreters"], "Logged");
  } catch (e) { return fail(e, "Could not log"); }
}
