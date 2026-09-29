"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { siteOrigin } from "@/lib/origin";
import { finishRegistration, registrationOptions, removePasskey, siteFor } from "@/server/passkeys";

export async function passkeyRegistrationOptionsAction() {
  const s = await requireSession();
  return registrationOptions(await getDb(), { id: s.userId, email: s.email, name: s.name }, siteFor(await siteOrigin()));
}

export async function finishPasskeyRegistrationAction(challengeId: string, response: { attestationObject: string; clientDataJSON: string; transports?: string[] }, name: string): Promise<{ ok: boolean; message: string }> {
  const s = await requireSession();
  try {
    await finishRegistration(await getDb(), s.userId, challengeId, response, name, siteFor(await siteOrigin()));
    revalidatePath("/settings/security");
    return { ok: true, message: "Passkey added. Next time, sign in with it: no password or code needed." };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Could not add the passkey" };
  }
}

export async function removePasskeyAction(id: string): Promise<void> {
  const s = await requireSession();
  await removePasskey(await getDb(), s.userId, id);
  revalidatePath("/settings/security");
}
