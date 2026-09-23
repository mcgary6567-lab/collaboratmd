"use server";

import { z } from "zod";

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
  error?: string;
  fieldErrors?: Partial<Record<keyof Fields, string>>;
  /** Echoed back so a rejected submission does not wipe what was typed. */
  values?: Partial<Record<keyof Fields, string>>;
};

/**
 * Validates the contact form and reports the result.
 *
 * Nothing is delivered and nothing is stored: this is a demonstration site
 * with no mailbox behind it. The validation is real so the form behaves the
 * way a working one would, and the confirmation says plainly that the message
 * went nowhere rather than implying someone will reply.
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

  const parsed = schema.safeParse({ ...raw, organization: raw.organization || undefined });

  if (!parsed.success) {
    const fieldErrors: ContactState["fieldErrors"] = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof Fields;
      fieldErrors[key] ??= issue.message;
    }
    return { error: "Please correct the highlighted fields.", fieldErrors, values: raw };
  }

  return { ok: true };
}
