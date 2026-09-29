/**
 * Time-based codes.
 *
 * Therapy: CMS's 8-minute rule for timed codes (15 minutes a unit). The total
 * timed minutes decide the total units (8 to 22 minutes is 1, 23 to 37 is 2,
 * and so on); each code first gets its whole 15-minute units, and the units
 * left go to the codes with the most minutes left over. Medicare and most
 * Medicaid plans use it; many commercial plans count each code on its own.
 *
 * Anesthesia: reported in minutes (837P SV103 "MJ"); the payer adds the
 * code's base units to time units of 15 minutes.
 */

/** Timed ("each 15 minutes") physical medicine and rehabilitation codes. */
export const TIMED_THERAPY_CODES = new Set([
  "97032", "97033", "97034", "97035", "97036", "97110", "97112", "97113", "97116", "97124", "97140",
  "97530", "97533", "97535", "97537", "97542", "97750", "97755", "97760", "97761", "97763",
]);

/** Physical medicine and rehabilitation codes, which Medicare wants a therapy discipline modifier on. */
export const isTherapyCode = (code: string) => /^97[0-7]\d{2}$/.test(code);
export const THERAPY_MODIFIERS = ["GP", "GO", "GN"];

export const isAnesthesiaCode = (code: string) => /^0[01]\d{3}$/.test(code) && Number(code) >= 100 && Number(code) <= 1999;
/** Who gave the anesthesia (AA, AD, QK, QX, QY, QZ): Medicare pays on it. */
export const ANESTHESIA_MODIFIERS = ["AA", "AD", "QK", "QX", "QY", "QZ"];

/** Units from total timed minutes under the 8-minute rule. */
export function unitsForMinutes(total: number) {
  if (!(total >= 8)) return 0;
  return Math.floor(total / 15) + (total % 15 >= 8 ? 1 : 0);
}

/**
 * Units for each timed code from its minutes, under the 8-minute rule
 * (the whole visit's timed minutes decide the total).
 */
export function eightMinuteRule(lines: { code: string; minutes: number }[]): Map<string, number> {
  const timed = lines.filter((l) => TIMED_THERAPY_CODES.has(l.code) && l.minutes > 0);
  const out = new Map<string, number>(timed.map((l) => [l.code, 0]));
  const total = timed.reduce((a, l) => a + l.minutes, 0);
  let left = unitsForMinutes(total);
  for (const l of timed) {
    const whole = Math.min(Math.floor(l.minutes / 15), left);
    out.set(l.code, (out.get(l.code) ?? 0) + whole);
    left -= whole;
  }
  // The remaining units go to the codes with the most minutes left over.
  const rest = timed.map((l) => ({ code: l.code, over: l.minutes % 15 })).sort((a, b) => b.over - a.over);
  for (const r of rest) {
    if (left <= 0) break;
    if (r.over === 0) continue;
    out.set(r.code, (out.get(r.code) ?? 0) + 1);
    left--;
  }
  return out;
}

/** Anesthesia time units: minutes over 15, to one decimal place. */
export const anesthesiaTimeUnits = (minutes: number) => Math.round((minutes / 15) * 10) / 10;
