"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import type { FormResult } from "@/components/action-form";
import { createApiKey, revokeApiKey, type ApiScope } from "@/server/api-keys";
import { createEndpoint, deleteEndpoint, retryDelivery, sendTestEvent, setEndpointEnabled } from "@/server/webhooks";

const PATH = "/settings/developers";
const fail = (e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : "Something went wrong" });

export type RevealResult = { ok: boolean; message: string; secret?: string } | undefined;

export async function createApiKeyAction(_prev: RevealResult, formData: FormData): Promise<RevealResult> {
  const s = await requireRole(["admin"]);
  try {
    const { key } = await createApiKey(await getDb(), s.practiceId, String(formData.get("name") ?? ""), String(formData.get("scope") ?? "read") as ApiScope, s.userId);
    revalidatePath(PATH);
    return { ok: true, message: "Copy this key now; it will not be shown again.", secret: key };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeApiKeyAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  await revokeApiKey(await getDb(), s.practiceId, id, s.userId);
  revalidatePath(PATH);
  return { ok: true, message: "Key revoked; calls with it now fail" };
}

export async function createWebhookAction(_prev: RevealResult, formData: FormData): Promise<RevealResult> {
  const s = await requireRole(["admin"]);
  try {
    const { secret } = await createEndpoint(await getDb(), s.practiceId, {
      url: String(formData.get("url") ?? ""),
      description: String(formData.get("description") ?? ""),
      events: formData.getAll("events").map(String),
    }, s.userId);
    revalidatePath(PATH);
    return { ok: true, message: "Endpoint added. Use this signing secret to verify deliveries; it will not be shown again.", secret };
  } catch (e) {
    return fail(e);
  }
}

export async function toggleWebhookAction(id: string, enabled: boolean, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  await setEndpointEnabled(await getDb(), s.practiceId, id, enabled, s.userId);
  revalidatePath(PATH);
  return { ok: true, message: enabled ? "Endpoint switched on" : "Endpoint paused" };
}

export async function deleteWebhookAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  await deleteEndpoint(await getDb(), s.practiceId, id, s.userId);
  revalidatePath(PATH);
  return { ok: true, message: "Endpoint deleted" };
}

export async function testWebhookAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const r = await sendTestEvent(await getDb(), s.practiceId, id);
    revalidatePath(PATH);
    return r.last?.status === "delivered"
      ? { ok: true, message: `Test event delivered (HTTP ${r.last.lastStatus})` }
      : { ok: false, message: `Test event not accepted: ${r.last?.lastError ?? "no answer"}. It will be retried.` };
  } catch (e) {
    return fail(e);
  }
}

export async function retryDeliveryAction(id: string, _prev: FormResult): Promise<FormResult> {
  const s = await requireRole(["admin"]);
  try {
    const r = await retryDelivery(await getDb(), s.practiceId, id);
    revalidatePath(PATH);
    return r.delivered ? { ok: true, message: "Delivered" } : { ok: false, message: "Still failing; see the error in the log" };
  } catch (e) {
    return fail(e);
  }
}
