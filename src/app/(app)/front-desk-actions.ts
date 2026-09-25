"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { CAN_WRITE, can, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { addDiscoveredCoverage, addInsurance, discoverCoverage, matchPayer } from "@/server/coverage";
import { practiceConfig } from "@/server/integrations";
import { linkThread, replySms } from "@/server/sms-inbox";
import { readInsuranceCard, type CardFields, type CardImage } from "@/lib/ai/insurance-card";

const fail = (e: unknown, fallback: string): FormResult => ({ ok: false, message: e instanceof Error ? e.message : fallback });

export async function addInsuranceAction(patientId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  const copay = String(formData.get("copay") ?? "").replace(/[$,\s]/g, "");
  try {
    await addInsurance(await getDb(), s.practiceId, patientId, {
      payerId: String(formData.get("payerId") ?? ""),
      memberId: String(formData.get("memberId") ?? ""),
      groupNumber: String(formData.get("groupNumber") ?? ""),
      relationship: String(formData.get("relationship") ?? "self"),
      copayCents: copay ? Math.round(Number(copay) * 100) || 0 : 0,
      makePrimary: formData.get("makePrimary") === "on",
    }, s.userId);
    revalidatePath(`/patients/${patientId}`);
    return { ok: true, message: "Insurance added. Check eligibility to confirm it is active." };
  } catch (e) {
    return fail(e, "Could not add the insurance");
  }
}

export type CardState = { ok: boolean; message: string; fields?: CardFields; payerId?: string | null } | undefined;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** Reads an insurance card photo. Only with a BAA on file, because the card is patient information. */
export async function readCardAction(_prev: CardState, formData: FormData): Promise<CardState> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  const ai = (await practiceConfig(db, s.practiceId)).anthropic;
  if (!ai?.phiAllowed) return { ok: false, message: "Card reading needs Claude connected with a BAA confirmed (Settings, Integrations)." };
  const images: CardImage[] = [];
  for (const key of ["front", "back"]) {
    const f = formData.get(key);
    if (!(f instanceof File) || !f.size) continue;
    if (!TYPES.has(f.type)) return { ok: false, message: `The ${key} photo must be JPEG, PNG, WebP or GIF (iPhone HEIC photos: share as JPEG).` };
    if (f.size > 5_000_000) return { ok: false, message: `The ${key} photo is over 5 MB; take it again at a lower resolution.` };
    images.push({ mediaType: f.type as CardImage["mediaType"], base64: Buffer.from(await f.arrayBuffer()).toString("base64") });
  }
  if (!images.length) return { ok: false, message: "Add a photo of the front of the card" };
  try {
    const fields = await readInsuranceCard(images, ai.apiKey);
    const payers = await db.select({ id: schema.payers.id, name: schema.payers.name }).from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId));
    const payerId = matchPayer(fields.payerName, payers);
    return { ok: true, message: fields.memberId ? "Read the card. Check each field against it before saving." : "Could not find a member ID on the card; fill it in by hand.", fields, payerId };
  } catch (e) {
    console.warn("Insurance card reading failed", e instanceof Error ? e.message : e);
    return { ok: false, message: "The card could not be read. Try a sharper, well-lit photo, or type the details." };
  }
}

export async function discoverCoverageAction(patientId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const r = await discoverCoverage(await getDb(), s.practiceId, patientId, s.userId);
    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/patients/coverage-discovery");
    const found = r.filter((x) => x.status === "found").length;
    return { ok: true, message: found ? `Found coverage with ${found} payer${found === 1 ? "" : "s"}. Review it under Insurance on the patient's page.` : `Asked ${r.length} payers; none found coverage.` };
  } catch (e) {
    return fail(e, "Could not search for coverage");
  }
}

export async function addDiscoveredAction(searchId: string, patientId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    await addDiscoveredCoverage(await getDb(), s.practiceId, searchId, s.userId);
    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/patients/coverage-discovery");
    return { ok: true, message: "Added as insurance" };
  } catch (e) {
    return fail(e, "Could not add it");
  }
}

export async function replySmsAction(phone: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  if (!can(s, "messages")) return { ok: false, message: "Your role does not include text messages" };
  const db = await getDb();
  try {
    await replySms(db, s.practiceId, await practiceConfig(db, s.practiceId), phone, String(formData.get("body") ?? ""), s.userId);
    revalidatePath("/messages");
    return { ok: true, message: "Sent" };
  } catch (e) {
    return fail(e, "Could not send");
  }
}

export async function linkThreadAction(phone: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  if (!can(s, "messages")) return { ok: false, message: "Your role does not include text messages" };
  try {
    await linkThread(await getDb(), s.practiceId, phone, String(formData.get("patientId") ?? ""));
    revalidatePath("/messages");
    return { ok: true, message: "Linked" };
  } catch (e) {
    return fail(e, "Could not link");
  }
}
