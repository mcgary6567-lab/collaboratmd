"use server";

import { z } from "zod";
import { getDb } from "@/db";
import { contactMessages } from "@/db/schema";

const schema = z.object({ email: z.string().trim().email("Enter the email address to remove.") });

export type UnsubscribeState = { ok?: boolean; error?: string; email?: string };

/**
 * Records an opt-out.
 *
 * CAN-SPAM requires a working opt-out mechanism on commercial email and gives
 * ten business days to honor it, so this has to do something real rather than
 * print a reassuring sentence. The request lands in the same table as every
 * other inbound message, under its own topic, which is where the suppression
 * list is built from before the next send.
 */
export async function unsubscribeAction(
  _prev: UnsubscribeState | undefined,
  formData: FormData,
): Promise<UnsubscribeState> {
  const email = String(formData.get("email") ?? "");
  const parsed = schema.safeParse({ email });
  if (!parsed.success) return { error: parsed.error.issues[0].message, email };

  try {
    const db = await getDb();
    await db.insert(contactMessages).values({
      name: "Unsubscribe request",
      email: parsed.data.email,
      topic: "unsubscribe",
      message: `Opt-out requested for ${parsed.data.email}.`,
      status: "new",
    });
    return { ok: true, email: parsed.data.email };
  } catch (err) {
    console.error("[collaboratmd] unsubscribe failed to record", err);
    return {
      error: "We could not record that just now. Please email us and we will remove you by hand.",
      email,
    };
  }
}
