import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { PATIENT_FIELDS, type ColumnProfile, type Mapping, type PatientField } from "@/lib/import/patients";

const SYSTEM_PROMPT = `You map the columns of a patient demographics export from an EHR or practice management system onto a billing system's fields.
You are given each column's header and a description of the shape of its values. You never see the values themselves.
Map a column only when you are confident; leave a field unmapped rather than guess. Each column maps to at most one field.
Respond with strict JSON: {"mapping": {"<field>": <column index or null>, ...}}.`;

/**
 * Asks Claude to map columns the rules could not place with confidence.
 *
 * Only headers and value shapes leave the server (see profileColumn), so no
 * patient data is sent. Returns null when no API key is configured or the
 * call fails; the caller then keeps the rule-based mapping.
 */
export async function mapColumnsWithAi(profiles: ColumnProfile[]): Promise<Mapping | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  try {
    const client = new Anthropic();
    const fields = PATIENT_FIELDS.map((f) => `${f.key}: ${f.label}`).join("\n");
    const columns = profiles
      .map((p, i) => `${i}. "${p.header}" (filled ${(p.filled * 100).toFixed(0)}%; values look like: ${p.shapes.join(", ") || "free text"})`)
      .join("\n");
    const response = await client.beta.messages.create({
      model: "claude-opus-5",
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Fields:\n${fields}\n\nColumns:\n${columns}` }],
    });
    if (response.stop_reason === "refusal") return null;
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    const parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { mapping?: Record<string, unknown> };
    return validate(parsed.mapping ?? {}, profiles.length);
  } catch (err) {
    console.warn("AI column mapping unavailable; keeping rule-based mapping", err instanceof Anthropic.APIError ? err.status : err);
    return null;
  }
}

/** Keeps only known fields, real column indexes, and one field per column. */
export function validate(raw: Record<string, unknown>, columnCount: number): Mapping {
  const known = new Set<string>(PATIENT_FIELDS.map((f) => f.key));
  const used = new Set<number>();
  const out: Mapping = {};
  for (const [field, col] of Object.entries(raw)) {
    if (!known.has(field)) continue;
    if (typeof col !== "number" || !Number.isInteger(col) || col < 0 || col >= columnCount || used.has(col)) continue;
    out[field as PatientField] = col;
    used.add(col);
  }
  return out;
}
