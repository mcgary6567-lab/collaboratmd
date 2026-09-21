import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CARC, RARC } from "@/lib/codes/carc";

export interface DenialExplanation {
  explanation: string;
  nextSteps: string[];
  source: "ai" | "rules";
}

/** Rules-based fallback using the CARC/RARC dictionaries. Never touches PHI. */
export function explainWithRules(carc: string, rarc?: string | null): DenialExplanation {
  const info = CARC[carc];
  const remark = rarc ? RARC[rarc] : undefined;
  if (!info) {
    return {
      explanation: `The payer denied this claim with adjustment reason code ${carc}${rarc ? ` and remark code ${rarc}` : ""}. ${remark ?? "Look up the code in the payer's remittance guide."}`,
      nextSteps: ["Review the remittance advice detail", "Contact the payer for clarification if the reason is unclear"],
      source: "rules",
    };
  }
  return {
    explanation: `${info.plain}${remark ? ` Remark ${rarc}: ${remark}` : ""}`,
    nextSteps: info.nextSteps,
    source: "rules",
  };
}

const SYSTEM_PROMPT = `You are a medical billing specialist assistant inside a revenue cycle management application.
You translate payer denial codes into plain language for billers and give concrete next steps.
You are given only codes and non-identifying claim context; never ask for or invent patient details.
Respond with strict JSON: {"explanation": string, "nextSteps": string[]} with 2 to 4 short, actionable next steps.`;

/**
 * Intelligent Claim Rejection Support.
 * Sends only codes and de-identified context (no names, DOB, member IDs) to Claude.
 * Falls back to the rules dictionary when no API key is configured or the call fails.
 */
export async function explainDenial(input: {
  carc: string;
  rarc?: string | null;
  cpts: string[];
  diagnoses: string[];
  payerType: string;
  claimAgeDays: number;
}): Promise<DenialExplanation> {
  if (!process.env.ANTHROPIC_API_KEY) return explainWithRules(input.carc, input.rarc);
  try {
    const client = new Anthropic();
    const dictionary = CARC[input.carc] ? `Reference: CARC ${input.carc} = ${CARC[input.carc].description}.` : "";
    const remark = input.rarc && RARC[input.rarc] ? `RARC ${input.rarc} = ${RARC[input.rarc]}.` : "";
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `Denial: CARC ${input.carc}${input.rarc ? `, RARC ${input.rarc}` : ""}. ${dictionary} ${remark}
Procedure codes: ${input.cpts.join(", ") || "n/a"}. Diagnoses: ${input.diagnoses.join(", ") || "n/a"}.
Payer type: ${input.payerType}. Claim age: ${input.claimAgeDays} days.`,
        },
      ],
    });
    if (response.stop_reason === "refusal") return explainWithRules(input.carc, input.rarc);
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { explanation?: string; nextSteps?: string[] };
    if (!parsed.explanation) throw new Error("Malformed AI response");
    return { explanation: parsed.explanation, nextSteps: parsed.nextSteps ?? [], source: "ai" };
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.warn(`AI explainer unavailable (${err.status}); using rules`);
    else console.warn("AI explainer failed; using rules", err);
    return explainWithRules(input.carc, input.rarc);
  }
}
