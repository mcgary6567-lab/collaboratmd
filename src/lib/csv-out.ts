/**
 * CSV for exports. Quotes fields that need it, and neutralizes values a
 * spreadsheet would run as a formula (=, +, -, @ at the start), since an
 * export opened in Excel must not execute something typed into a record.
 */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));
