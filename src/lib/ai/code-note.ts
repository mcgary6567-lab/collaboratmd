import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * Clinical notes contain patient information, so sending one to an AI model
 * needs a business associate agreement with the model provider. Off unless
 * the practice's deployment sets AI_PHI_ALLOWED=1 as well as an API key.
 */
export const noteCodingEnabled = () => !!process.env.ANTHROPIC_API_KEY && process.env.AI_PHI_ALLOWED === "1";

const SYSTEM_PROMPT = `You are a certified medical coder. From a clinical note for an office visit, suggest CPT procedure codes and ICD-10-CM diagnosis codes the documentation supports.
Only suggest codes from the lists provided. Only suggest what the note documents; if something needed for a code is missing, say so in "gaps" instead of assuming it.
Respond with strict JSON: {"cpts": [{"code": "...", "why": "..."}], "diagnoses": [{"code": "...", "why": "..."}], "gaps": ["..."]}.
Keep each "why" to one sentence quoting or paraphrasing the note.`;

export type NoteCoding = { cpts: { code: string; why: string }[]; diagnoses: { code: string; why: string }[]; gaps: string[] };

/** Keeps only codes that exist in the practice's lists, once each. */
export function validateNoteCoding(raw: unknown, cptCodes: Set<string>, icdCodes: Set<string>): NoteCoding {
  const r = (raw ?? {}) as Record<string, unknown>;
  const pick = (xs: unknown, known: Set<string>) => {
    const seen = new Set<string>();
    return (Array.isArray(xs) ? xs : []).flatMap((x) => {
      const code = typeof x?.code === "string" ? x.code.trim().toUpperCase() : "";
      if (!known.has(code) || seen.has(code)) return [];
      seen.add(code);
      return [{ code, why: typeof x?.why === "string" ? x.why.slice(0, 300) : "" }];
    });
  };
  return {
    cpts: pick(r.cpts, cptCodes),
    diagnoses: pick(r.diagnoses, icdCodes),
    gaps: (Array.isArray(r.gaps) ? r.gaps : []).filter((g): g is string => typeof g === "string").slice(0, 8).map((g) => g.slice(0, 300)),
  };
}

export async function codeNoteWithAi(note: string, cpts: { code: string; description: string }[], icds: { code: string; description: string }[]): Promise<NoteCoding | null> {
  if (!noteCodingEnabled()) return null;
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 4096,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "medium" },
    system: [{
      type: "text",
      text: `${SYSTEM_PROMPT}\n\nCPT codes:\n${cpts.map((c) => `${c.code} ${c.description}`).join("\n")}\n\nICD-10-CM codes:\n${icds.map((c) => `${c.code} ${c.description}`).join("\n")}`,
      cache_control: { type: "ephemeral" },
    }],
    messages: [{ role: "user", content: `Clinical note:\n${note.slice(0, 20_000)}` }],
  });
  if (response.stop_reason === "refusal") return null;
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
  const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  return validateNoteCoding(parsed, new Set(cpts.map((c) => c.code)), new Set(icds.map((c) => c.code)));
}
