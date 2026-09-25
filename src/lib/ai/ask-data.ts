import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { describeDatasets, validateAiAnswer, type Answer, type Named } from "@/server/ask-data";
import { RANGES } from "@/server/report-builder";

const SYSTEM_PROMPT = `You translate a medical billing user's question into a report definition for their billing system's report builder.
You may only use the datasets, columns, groupings, statuses and date ranges listed. You never see the data itself.
Pick the dataset that answers the question. Group when the question asks "by", "per", "which", "top" or for a breakdown; otherwise list rows.
Choose columns that answer the question, or an empty list for the dataset's defaults. Use a payer or provider id only if the question names one from the lists.
If the question cannot be answered with these reports, choose the closest report and say what it cannot show in "note".
Respond with strict JSON only: {"dataset": "...", "columns": ["..."], "group": "..." or null, "range": "...", "status": "..." or null, "payerId": "..." or null, "providerId": "..." or null, "note": "..." or null}`;

/**
 * Asks Claude which report answers the question. Returns null when no key is
 * configured, the call fails, or the reply does not validate; the caller then
 * falls back to the keyword parser.
 */
export async function askWithAi(question: string, payers: Named[], providers: Named[], apiKey?: string | null): Promise<Answer | null> {
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey });
    const context = [
      `Reports:\n${describeDatasets()}`,
      `Date ranges: ${Object.entries(RANGES).map(([k, l]) => `${k} (${l})`).join(", ")}`,
      `Payers:\n${payers.map((p) => `${p.id}: ${p.name}`).join("\n") || "(none)"}`,
      `Providers:\n${providers.map((p) => `${p.id}: ${p.name}`).join("\n") || "(none)"}`,
    ].join("\n\n");
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 1024,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM_PROMPT }, { type: "text", text: context, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: question }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return validateAiAnswer(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)), payers, providers);
  } catch (err) {
    console.warn("Ask-your-data AI unavailable; using keywords", err instanceof Anthropic.APIError ? err.status : err);
    return null;
  }
}
