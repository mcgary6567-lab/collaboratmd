"use server";

import { headers } from "next/headers";
import { getDb } from "@/db";
import { startPasskeySession } from "@/lib/auth";
import { clientIp } from "@/lib/ip";
import { siteOrigin } from "@/lib/origin";
import { finishLogin, loginOptions, siteFor } from "@/server/passkeys";
import { hit } from "@/server/throttle";

export async function passkeyLoginOptionsAction(): Promise<{ ok: true; options: Awaited<ReturnType<typeof loginOptions>> } | { ok: false; message: string }> {
  const db = await getDb();
  if (!(await hit(db, "login", clientIp(await headers()))).ok) return { ok: false, message: "Too many sign-in attempts from this network. Wait a few minutes." };
  return { ok: true, options: await loginOptions(db, siteFor(await siteOrigin())) };
}

export async function passkeyLoginAction(challengeId: string, response: { id: string; authenticatorData: string; clientDataJSON: string; signature: string }): Promise<{ ok: boolean; message?: string }> {
  const db = await getDb();
  try {
    const user = await finishLogin(db, challengeId, response, siteFor(await siteOrigin()));
    if (!user) return { ok: false, message: "This passkey is not registered here" };
    const r = await startPasskeySession(db, user);
    return r.ok ? { ok: true } : { ok: false, message: "error" in r ? r.error : "Passkey sign-in failed" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Passkey sign-in failed" };
  }
}
