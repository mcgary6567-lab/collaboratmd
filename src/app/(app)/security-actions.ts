"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession, signingKey } from "@/lib/auth";
import { confirmEnrollment, disableMfa, regenerateRecoveryCodes, startEnrollment } from "@/server/mfa";

type Result = { ok: boolean; message?: string; secret?: string; qrSvg?: string; codes?: string[] };
const fail = (e: unknown): Result => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });

export async function startMfaAction(): Promise<Result> {
  const s = await requireSession();
  try {
    const db = await getDb();
    const { secret, uri } = await startEnrollment(db, s.userId, signingKey());
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200 });
    return { ok: true, secret, qrSvg };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmMfaAction(code: string): Promise<Result> {
  const s = await requireSession();
  try {
    const db = await getDb();
    const codes = await confirmEnrollment(db, s.userId, code, signingKey());
    revalidatePath("/settings/security");
    return { ok: true, codes, message: "Two-factor sign-in is on." };
  } catch (e) {
    return fail(e);
  }
}

export async function disableMfaAction(code: string): Promise<Result> {
  const s = await requireSession();
  try {
    const db = await getDb();
    const [practice] = await db.select({ requireMfa: schema.practices.requireMfa }).from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
    if (practice?.requireMfa) throw new Error("This practice requires two-factor sign-in, so it cannot be turned off");
    await disableMfa(db, s.userId, code, signingKey());
    revalidatePath("/settings/security");
    return { ok: true, message: "Two-factor sign-in is off." };
  } catch (e) {
    return fail(e);
  }
}

export async function newRecoveryCodesAction(code: string): Promise<Result> {
  const s = await requireSession();
  try {
    const db = await getDb();
    return { ok: true, codes: await regenerateRecoveryCodes(db, s.userId, code, signingKey()) };
  } catch (e) {
    return fail(e);
  }
}

/** Admin: require two-factor for everyone in the practice. */
export async function setRequireMfaAction(required: boolean): Promise<void> {
  const s = await requireSession();
  if (s.role !== "admin") throw new Error("Only an administrator can change this");
  const db = await getDb();
  await db.update(schema.practices).set({ requireMfa: required }).where(eq(schema.practices.id, s.practiceId));
  await db.insert(schema.auditLog).values({ practiceId: s.practiceId, userId: s.userId, action: required ? "require_mfa_on" : "require_mfa_off", entity: "practice", entityId: s.practiceId });
  revalidatePath("/settings/security");
}
