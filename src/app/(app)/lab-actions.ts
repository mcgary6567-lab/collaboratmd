"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { CAN_WRITE, requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { cancelLabOrder, createLabOrder, markLabReviewed, simulateLabResult } from "@/server/labs";

const fail = (e: unknown): FormResult => ({ ok: false, message: e instanceof Error ? e.message : "Something went wrong" });

export async function createLabOrderAction(patientId: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const order = await createLabOrder(
      db, s.practiceId,
      {
        patientId,
        providerId: String(formData.get("providerId") ?? ""),
        labCode: String(formData.get("labCode") ?? ""),
        testCodes: formData.getAll("tests").map(String),
        diagnoses: String(formData.get("diagnoses") ?? "").split(/[\s,]+/),
      },
      s.userId,
    );
    revalidatePath(`/patients/${patientId}`);
    revalidatePath("/labs");
    return { ok: true, message: `Order ${order.placerOrderNumber} created` };
  } catch (e) {
    return fail(e);
  }
}

/** DEMO ONLY: generates a lab's result for the order and processes it like a real one. */
export async function simulateLabAction(orderId: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(CAN_WRITE);
  try {
    const db = await getDb();
    const r = await simulateLabResult(db, s.practiceId, orderId, s.userId);
    revalidatePath(`/labs/${orderId}`);
    revalidatePath("/labs");
    return { ok: r.status === "processed", message: r.message };
  } catch (e) {
    return fail(e);
  }
}

export async function reviewLabAction(orderId: string): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await markLabReviewed(db, s.practiceId, orderId, s.userId);
  revalidatePath(`/labs/${orderId}`);
  revalidatePath("/labs");
}

export async function cancelLabAction(orderId: string): Promise<void> {
  const s = await requireRole(CAN_WRITE);
  const db = await getDb();
  await cancelLabOrder(db, s.practiceId, orderId, s.userId);
  revalidatePath(`/labs/${orderId}`);
  revalidatePath("/labs");
}
