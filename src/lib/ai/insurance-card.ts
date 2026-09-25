import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export type CardImage = { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; base64: string };
export type CardFields = {
  payerName: string | null;
  memberId: string | null;
  groupNumber: string | null;
  subscriberName: string | null;
  planName: string | null;
  payerPhone: string | null;
  rxBin: string | null;
  rxPcn: string | null;
  copays: string | null;
};

const FIELDS: (keyof CardFields)[] = ["payerName", "memberId", "groupNumber", "subscriberName", "planName", "payerPhone", "rxBin", "rxPcn", "copays"];

const SYSTEM_PROMPT = `You read US health insurance cards for a medical billing office.
Transcribe exactly what is printed; never infer or invent a value. If a field is not printed or not legible, use null.
memberId is the member or subscriber ID (often labeled ID, Member ID, Subscriber ID); include any prefix letters exactly as printed.
payerName is the insurance company or plan administrator (e.g. the logo name), not the employer.
copays is a short summary of any copay amounts printed (e.g. "PCP $25, Specialist $50, ER $250").
Respond with strict JSON only: {"payerName": ..., "memberId": ..., "groupNumber": ..., "subscriberName": ..., "planName": ..., "payerPhone": ..., "rxBin": ..., "rxPcn": ..., "copays": ...}`;

/**
 * Reads the front (and optionally back) of an insurance card with Claude.
 * The images contain patient information, so callers must only use this when
 * the practice has confirmed a BAA with Anthropic covering its key. The images
 * are sent once and not stored here.
 */
export async function readInsuranceCard(images: CardImage[], apiKey: string): Promise<CardFields> {
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.create({
    model: "claude-opus-5",
    max_tokens: 1024,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: SYSTEM_PROMPT,
    messages: [{
      role: "user",
      content: [
        ...images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.base64 } })),
        { type: "text" as const, text: images.length > 1 ? "Front and back of the card." : "Front of the card." },
      ],
    }],
  });
  if (response.stop_reason === "refusal") throw new Error("The card could not be read");
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
  return cleanCardFields(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
}

/** Keeps known fields as short trimmed strings. */
export function cleanCardFields(raw: unknown): CardFields {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(FIELDS.map((k) => {
    const v = r[k];
    return [k, typeof v === "string" && v.trim() && v.trim().toLowerCase() !== "null" ? v.trim().slice(0, 120) : null];
  })) as CardFields;
}
