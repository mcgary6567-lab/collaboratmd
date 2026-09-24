"use server";

import { z } from "zod";
import { getDb } from "@/db";
import { contactMessages } from "@/db/schema";
import { notifyTeam, acknowledge } from "@/server/notify";

const schema = z.object({
  name: z.string().trim().min(2, "Enter your full name."),
  email: z.string().trim().email("Enter a valid work email address."),
  organization: z.string().trim().max(120).optional(),
  topic: z.enum(["sales", "investor", "support", "privacy", "security", "press"]),
  message: z.string().trim().min(20, "Tell us a little more, at least 20 characters."),
  fund: z.string().trim().max(120).optional(),
  stage: z.string().trim().max(60).optional(),
  checkSize: z.string().trim().max(60).optional(),
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

/** Campaign parameters worth keeping. Anything else on the URL is ignored. */
const SOURCE_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ref"];

function readSource(formData: FormData): Record<string, string> | null {
  const raw = String(formData.get("source") ?? "");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const k of SOURCE_KEYS) {
      const v = parsed[k];
      if (typeof v === "string" && v.trim()) out[k] = v.trim().slice(0, 200);
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/**
 * Validates a contact submission, records it, and notifies the team.
 *
 * Storage is what the confirmation actually promises, so it happens first and
 * the reference comes from the stored row. Email is best effort on top: if the
 * provider is unconfigured or down, the submission still succeeded and the
 * sender is told so, because failing the form at that point would lose a lead
 * that is already safely in the database.
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
    fund: String(formData.get("fund") ?? ""),
    stage: String(formData.get("stage") ?? ""),
    checkSize: String(formData.get("checkSize") ?? ""),
  };

  // Bots fill every field they find. A human never sees this one.
  if (String(formData.get("company_website") ?? "").trim() !== "") {
    return { ok: true, reference: "queued" };
  }

  const parsed = schema.safeParse({
    ...raw,
    organization: raw.organization || undefined,
    fund: raw.fund || undefined,
    stage: raw.stage || undefined,
    checkSize: raw.checkSize || undefined,
  });

  if (!parsed.success) {
    const fieldErrors: ContactState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof Fields;
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Please correct the highlighted fields.", fieldErrors, values: raw };
  }

  const source = readSource(formData);
  const investor = parsed.data.topic === "investor";

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
        fund: investor ? parsed.data.fund ?? null : null,
        stage: investor ? parsed.data.stage ?? null : null,
        checkSize: investor ? parsed.data.checkSize ?? null : null,
        source,
      })
      .returning();

    const reference = row.id.split("-")[0].toUpperCase();
    const submission = {
      reference,
      name: parsed.data.name,
      email: parsed.data.email,
      organization: parsed.data.organization ?? null,
      topic: parsed.data.topic,
      message: parsed.data.message,
      fund: investor ? parsed.data.fund ?? null : null,
      stage: investor ? parsed.data.stage ?? null : null,
      checkSize: investor ? parsed.data.checkSize ?? null : null,
      source,
    };

    // Settled, not awaited into the failure path: the lead is already saved.
    await Promise.allSettled([notifyTeam(submission), acknowledge(submission)]);

    return { ok: true, reference };
  } catch (err) {
    console.error("[collaboratmd] contact message failed to save", err);
    return {
      error: "We could not record your message just now. Please try again in a moment.",
      values: raw,
    };
  }
}
