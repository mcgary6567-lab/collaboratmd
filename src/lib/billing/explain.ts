/**
 * "Why do I owe this?": the patient's share of a visit in plain words, from
 * the reasons the payer gave on its 835 (group PR, patient responsibility).
 * Used on statements and in the patient portal, in the patient's language.
 */
import { money } from "@/lib/utils";

export type ShareReason = { reason: string; amountCents: number };
type Lang = "en" | "es";

const TEXT: Record<Lang, { byReason: Record<string, (amount: string) => string>; other: (amount: string, code: string) => string; selfPay: string }> = {
  en: {
    byReason: {
      "1": (a) => `${a} went toward your plan's deductible, the amount you pay each year before your plan starts to pay.`,
      "2": (a) => `${a} is your coinsurance, your share of the cost once the deductible is met.`,
      "3": (a) => `${a} is your copay for this visit.`,
      "66": (a) => `${a} went toward your plan's blood deductible.`,
      "96": (a) => `${a} is for a service your plan does not cover.`,
      "204": (a) => `${a} is for a service your plan does not cover.`,
      "242": (a) => `${a} is because this provider is outside your plan's network.`,
      "119": (a) => `${a} is because your plan's limit for this service had been reached.`,
      "26": (a) => `${a} is because your plan did not cover you yet on the date of the visit.`,
      "27": (a) => `${a} is because your plan's coverage had ended before the date of the visit.`,
      "187": (a) => `${a} is to be paid from your health savings or flexible spending account.`,
    },
    other: (a, code) => `${a} is your share under your plan (payer reason ${code}).`,
    selfPay: "No insurance was billed for this visit, so the balance is the charge less any discount.",
  },
  es: {
    byReason: {
      "1": (a) => `${a} se aplicó a su deducible, la cantidad que usted paga cada año antes de que su plan empiece a pagar.`,
      "2": (a) => `${a} es su coseguro, su parte del costo después de cubrir el deducible.`,
      "3": (a) => `${a} es su copago por esta visita.`,
      "66": (a) => `${a} se aplicó al deducible de sangre de su plan.`,
      "96": (a) => `${a} es por un servicio que su plan no cubre.`,
      "204": (a) => `${a} es por un servicio que su plan no cubre.`,
      "242": (a) => `${a} se debe a que este proveedor está fuera de la red de su plan.`,
      "119": (a) => `${a} se debe a que ya se alcanzó el límite de su plan para este servicio.`,
      "26": (a) => `${a} se debe a que su plan todavía no lo cubría en la fecha de la visita.`,
      "27": (a) => `${a} se debe a que la cobertura de su plan terminó antes de la fecha de la visita.`,
      "187": (a) => `${a} se paga con su cuenta de ahorros para la salud o de gastos flexibles.`,
    },
    other: (a, code) => `${a} es su parte según su plan (motivo del pagador ${code}).`,
    selfPay: "No se facturó a ningún seguro por esta visita, así que el saldo es el cargo menos cualquier descuento.",
  },
};

const SINCE: Record<Lang, (owe: string) => string> = {
  en: (owe) => `Payments, other insurance and adjustments since then bring what you owe for this visit to ${owe}.`,
  es: (owe) => `Los pagos, otros seguros y ajustes desde entonces dejan lo que debe por esta visita en ${owe}.`,
};

/**
 * One sentence per reason, largest first; reasons of the same kind are added
 * together. When what is owed now differs from what the payer assigned (a
 * payment, a secondary payer, a discount), a last sentence says so. No reasons
 * from the payer (not processed yet, or reported at the claim level) gives none.
 */
export function explainShare(reasons: ShareReason[], lang: Lang = "en", billedToInsurance = true, youOweCents?: number): string[] {
  const t = TEXT[lang];
  if (!billedToInsurance) return [t.selfPay];
  const byCode = new Map<string, number>();
  for (const r of reasons) if (r.amountCents > 0) byCode.set(r.reason, (byCode.get(r.reason) ?? 0) + r.amountCents);
  const lines = [...byCode].sort((a, b) => b[1] - a[1]).map(([code, cents]) => (t.byReason[code] ?? ((a: string) => t.other(a, code)))(money(cents)));
  const assigned = [...byCode.values()].reduce((a, b) => a + b, 0);
  if (lines.length && youOweCents !== undefined && youOweCents !== assigned) lines.push(SINCE[lang](money(youOweCents)));
  return lines;
}
