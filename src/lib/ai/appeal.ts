import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CARC, RARC } from "@/lib/codes/carc";
import { PLACEHOLDERS, unknownPlaceholders } from "@/lib/appeals";

const SYSTEM_PROMPT = `You draft the body of an appeal letter from a medical practice to a health insurer, asking it to reconsider a denied claim.
You never see or write any patient details. Where the letter needs one, write a placeholder exactly as listed, for example {{PATIENT_NAME}} or {{DATE_OF_SERVICE}}; the practice fills them in.
Allowed placeholders: ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}.
Write two to four short paragraphs: why the claim should be paid, grounded in the denial reason and the codes given, and what documentation is enclosed. Where the practice must supply a fact you cannot know, write it in square brackets as an instruction, for example [attach the authorization approval]. Do not invent clinical facts, policy numbers or dates.
Write only the body: no letterhead, address block, greeting or signature. Plain text, no markdown.`;

/**
 * Drafts an appeal body with Claude from codes and non-identifying context
 * only. Returns null when no API key is configured or the draft cannot be
 * used; the caller then uses the category template.
 */
export async function draftAppealBody(input: { carc: string; rarc?: string | null; category: string; cpts: string[]; diagnoses: string[]; payerType: string }): Promise<string | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const carc = CARC[input.carc];
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{
        role: "user",
        content: `Denial reason: CARC ${input.carc}${carc ? ` (${carc.description})` : ""}${input.rarc ? `; RARC ${input.rarc}${RARC[input.rarc] ? ` (${RARC[input.rarc]})` : ""}` : ""}.
Denial category: ${input.category.replace(/_/g, " ")}.
Procedure codes: ${input.cpts.join(", ") || "n/a"}. Diagnosis codes: ${input.diagnoses.join(", ") || "n/a"}.
Payer type: ${input.payerType}.`,
      }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("").trim();
    if (!text || unknownPlaceholders(text).length) return null;
    return text;
  } catch (err) {
    console.warn("AI appeal draft unavailable; using template", err instanceof Anthropic.APIError ? err.status : err);
    return null;
  }
}
