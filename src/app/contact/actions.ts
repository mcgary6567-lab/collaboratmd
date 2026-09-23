"use server";

import { z } from "zod";
import { getDb } from "@/db";
import { contactMessages } from "@/db/schema";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().email("Enter a valid work email address."),
  organization: z.string().trim().max(120).optional(),
  topic: z.enum(["sales", "support", "privacy", "security", "press"]),
  message: z.string().trim().min(20, "Tell us a little more, at least 20 characters."),
});

type Fields = z.infer<typeof schema>;

export type ContactState = {
  ok?: boolean;
  reference?: string;
  error?: string;
  fieldErrors?: Partial<Record<keyof Fields, string>>;
  /** Echoed back so a rejected submission does not wipe what was typed. */
  values?: Partial<Record<keyof Fields, string>>;
};

/**
 * Validates a contact submission and records it.
 *
 * The message is written to the database, so the confirmation the sender sees
 * is a statement about something that happened rather than a courtesy. Routing
 * it onward to a mailbox is a separate step that needs an email provider
 * credential; until one is configured, messages are read from the table.
 *
 * The reference shown back to the sender is the first segment of the row id,
 * which is enough to find the record without exposing the whole key.
 */
export async function contactAction(
  _prev: ContactState | undefined,
  formData: FormData,
): Promise<ContactState> {
  const raw = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    organization: String(formData.get("organization") ?? ""),
    topic: String(formData.get("topic") ?? ""),
    message: String(formData.get("message") ?? ""),
  };

  // Bots fill every field they find. A human never sees this one.
  if (String(formData.get("company_website") ?? "").trim() !== "") {
    return { ok: true, reference: "queued" };
  }

  const parsed = schema.safeParse({ ...raw, organization: raw.organization || undefined });

  if (!parsed.success) {
    const fieldErrors: ContactState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof Fields;
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Please correct the highlighted fields.", fieldErrors, values: raw };
  }

  try {
    const db = await getDb();
    const [row] = await db
      .insert(contactMessages)
      .values({
        name: parsed.data.name,
        email: parsed.data.email,
        organization: parsed.data.organization ?? null,
        topic: parsed.data.topic,
        message: parsed.data.message,
      })
      .returning();

    return { ok: true, reference: row.id.split("-")[0].toUpperCase() };
  } catch (err) {
    console.error("[collaboratmd] contact message failed to save", err);
    return {
      error: "We could not record your message just now. Please try again in a moment.",
      values: raw,
    };
  }
}
