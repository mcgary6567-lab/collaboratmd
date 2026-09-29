/**
 * The CMS-1500 (02/12) paper claim, as text placed on the form's print grid:
 * 10 characters to the inch across and 6 lines to the inch down, the grid the
 * red OCR form is designed around. Each field is a line and a column (both
 * counted from 1 at the top left of the sheet), so the same list prints data
 * only onto a pre-printed form, or with box captions onto plain paper.
 *
 * Payers scanning red forms need the data inside the boxes; printers differ,
 * so the practice sets an offset after a test print (Settings, Practice profile).
 * Up to six service lines fit on a form; a longer claim continues on more
 * forms, with the total only on the last (NUCC instructions, item 28).
 */

export type Field = { line: number; col: number; text: string; box?: string };

export type Cms1500Input = {
  payer: { name: string; address1?: string | null; city?: string | null; state?: string | null; zip?: string | null; type: string };
  insured: { id: string; lastName: string; firstName: string; address1?: string | null; city?: string | null; state?: string | null; zip?: string | null; phone?: string | null; dob?: string | null; sex?: string | null; groupNumber?: string | null; planName?: string | null };
  patient: { lastName: string; firstName: string; dob: string; sex: string; address1?: string | null; city?: string | null; state?: string | null; zip?: string | null; phone?: string | null; accountNumber: string };
  relationship: string;
  otherInsurance: boolean;
  accident: { employment: boolean; auto: boolean; autoState?: string | null; other: boolean; date?: string | null; propertyClaimNumber?: string | null };
  referring?: { lastName: string; firstName: string; npi: string } | null;
  priorAuth?: string | null;
  resubmission?: { code: string; originalRef: string } | null;
  diagnoses: string[];
  lines: { from: string; to?: string; pos: string; cpt: string; modifiers: string[]; pointers: number[]; chargeCents: number; units: number; renderingNpi: string; ndc?: string | null; ndcUnit?: string | null; ndcQuantity?: number | null }[];
  totalCents: number;
  paidCents: number;
  billing: { name: string; address1: string; city: string; state: string; zip: string; phone?: string | null; npi: string; taxId: string; taxIdIsSsn?: boolean };
  facility?: { name: string; address1: string; city: string; state: string; zip: string; npi?: string | null } | null;
  signedOn: string; // YYYY-MM-DD
};

const X = "X";
const up = (s: string | null | undefined, max = 99) => (s ?? "").toUpperCase().replace(/[^A-Z0-9 ,.'&/#-]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** "2026-09-01" as MM DD YY with the spaces the date boxes have. */
const mdy = (d: string | null | undefined, year4 = false) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${m} ${day} ${year4 ? y : y.slice(2)}`;
};
const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
/** Money split across the dollars and cents columns: dollars right-aligned to end just before the cents. */
const dollars = (cents: number, width: number) => String(Math.floor(Math.abs(cents) / 100)).padStart(width);
const centsOf = (cents: number) => String(Math.abs(cents) % 100).padStart(2, "0");
const name = (last: string, first: string) => up(`${last}, ${first}`, 28);
/** ICD-10-CM without the dot, as the form wants. */
const icd = (c: string) => c.replace(".", "").toUpperCase();

const TYPE_COL: Record<string, number> = { medicare: 2, medicaid: 9, commercial: 31, workers_comp: 45, auto: 45 };
const REL_COL: Record<string, number> = { self: 33, spouse: 38, child: 42, other: 47 };

export function cms1500Pages(c: Cms1500Input): Field[][] {
  const head: Field[] = [];
  const put = (line: number, col: number, text: string | null | undefined, box?: string) => { if (text) head.push({ line, col, text, box }); };

  // Carrier block, top right.
  put(1, 50, up(c.payer.name, 30), "Payer");
  put(2, 50, up(c.payer.address1, 30));
  put(3, 50, up([c.payer.city, c.payer.state].filter(Boolean).join(" ") + (c.payer.zip ? ` ${c.payer.zip}` : ""), 30));

  // 1 and 1a
  put(8, TYPE_COL[c.payer.type] ?? 45, X, "1");
  put(8, 50, up(c.insured.id, 29), "1a");
  // 2, 3, 4
  put(10, 2, name(c.patient.lastName, c.patient.firstName), "2");
  put(10, 31, mdy(c.patient.dob, true), "3");
  put(10, c.patient.sex === "F" ? 47 : 42, c.patient.sex === "F" || c.patient.sex === "M" ? X : "");
  put(10, 50, name(c.insured.lastName, c.insured.firstName), "4");
  // 5, 6, 7
  put(12, 2, up(c.patient.address1, 28), "5");
  put(12, REL_COL[c.relationship] ?? 47, X, "6");
  put(12, 50, up(c.insured.address1, 29), "7");
  put(14, 2, up(c.patient.city, 24));
  put(14, 26, up(c.patient.state, 2));
  put(14, 50, up(c.insured.city, 23));
  put(14, 74, up(c.insured.state, 2));
  put(16, 2, digits(c.patient.zip).slice(0, 9));
  const pp = digits(c.patient.phone).slice(-10);
  if (pp.length === 10) { put(16, 16, pp.slice(0, 3)); put(16, 20, `${pp.slice(3, 6)}${pp.slice(6)}`); }
  put(16, 50, digits(c.insured.zip).slice(0, 9));
  const ip = digits(c.insured.phone).slice(-10);
  if (ip.length === 10) { put(16, 66, ip.slice(0, 3)); put(16, 70, `${ip.slice(3, 6)}${ip.slice(6)}`); }

  // 10a-10c: related to employment, auto accident (and state), other accident
  put(20, c.accident.employment ? 35 : 41, X, "10a");
  put(22, c.accident.auto ? 35 : 41, X, "10b");
  if (c.accident.auto) put(22, 45, up(c.accident.autoState, 2));
  put(24, c.accident.other ? 35 : 41, X, "10c");
  // 11, 11a, 11b, 11c, 11d
  put(18, 50, up(c.insured.groupNumber, 29), "11");
  if (c.relationship !== "self" && c.insured.dob) {
    put(20, 53, mdy(c.insured.dob, true), "11a");
    put(20, c.insured.sex === "F" ? 75 : 68, c.insured.sex === "F" || c.insured.sex === "M" ? X : "");
  }
  if (c.accident.propertyClaimNumber) { put(22, 50, "Y4", "11b"); put(22, 53, up(c.accident.propertyClaimNumber, 26)); }
  put(24, 50, up(c.insured.planName ?? c.payer.name, 29), "11c");
  put(26, c.otherInsurance ? 52 : 57, X, "11d");
  // 12, 13: signatures on file
  put(29, 9, "SIGNATURE ON FILE", "12");
  put(29, 44, mdy(c.signedOn));
  put(29, 56, "SIGNATURE ON FILE", "13");
  // 14: date of injury, qualifier 431 (onset of current symptoms or illness)
  if (c.accident.date && (c.accident.employment || c.accident.auto || c.accident.other)) { put(32, 3, mdy(c.accident.date), "14"); put(32, 16, "431"); }
  // 17, 17b
  if (c.referring) { put(34, 1, "DN", "17"); put(34, 4, name(c.referring.lastName, c.referring.firstName).slice(0, 24)); put(34, 34, c.referring.npi, "17b"); }
  // 20: outside lab
  put(36, 57, X, "20");
  // 21: ICD indicator 0 (ICD-10), then A-L across three rows of four
  put(38, 38, "0", "21");
  c.diagnoses.slice(0, 12).forEach((d, i) => put(39 + Math.floor(i / 4), 3 + (i % 4) * 13, icd(d)));
  // 22, 23
  if (c.resubmission) { put(38, 50, c.resubmission.code, "22"); put(38, 62, up(c.resubmission.originalRef, 18)); }
  if (c.priorAuth) put(40, 50, up(c.priorAuth, 29), "23");

  // 25, 26, 27
  put(57, 1, digits(c.billing.taxId), "25");
  put(57, c.billing.taxIdIsSsn ? 17 : 19, X);
  put(57, 23, up(c.patient.accountNumber, 14), "26");
  put(57, 37, X, "27");
  // 31, 32, 33
  put(59, 1, "SIGNATURE ON FILE", "31");
  put(60, 1, mdy(c.signedOn));
  const f = c.facility;
  if (f) {
    put(58, 23, up(f.name, 26), "32");
    put(59, 23, up(f.address1, 26));
    put(60, 23, up(`${f.city} ${f.state} ${f.zip}`, 26));
    if (f.npi) put(61, 23, f.npi, "32a");
  }
  const bp = digits(c.billing.phone).slice(-10);
  if (bp.length === 10) { put(57, 66, bp.slice(0, 3), "33"); put(57, 70, `${bp.slice(3, 6)}${bp.slice(6)}`); }
  put(58, 50, up(c.billing.name, 29), bp.length === 10 ? undefined : "33");
  put(59, 50, up(c.billing.address1, 29));
  put(60, 50, up(`${c.billing.city} ${c.billing.state} ${digits(c.billing.zip).slice(0, 9)}`, 29));
  put(61, 50, c.billing.npi, "33a");

  // 24: six service lines a form; the diagnosis pointers are letters.
  const chunks: Cms1500Input["lines"][] = [];
  for (let i = 0; i < Math.max(c.lines.length, 1); i += 6) chunks.push(c.lines.slice(i, i + 6));
  return chunks.map((chunk, pageIndex) => {
    const page = [...head];
    const last = pageIndex === chunks.length - 1;
    chunk.forEach((l, i) => {
      const line = 45 + i * 2;
      const at = (col: number, text: string, box?: string) => { if (text) page.push({ line, col, text, box }); };
      at(1, mdy(l.from), i === 0 ? "24A" : undefined);
      at(10, mdy(l.to ?? l.from));
      at(19, l.pos, i === 0 ? "24B" : undefined);
      at(25, l.cpt.toUpperCase(), i === 0 ? "24D" : undefined);
      l.modifiers.slice(0, 4).forEach((m, k) => at(32 + k * 3, m.toUpperCase()));
      at(45, l.pointers.slice(0, 4).map((p) => "ABCDEFGHIJKL"[p - 1] ?? "").join(""), i === 0 ? "24E" : undefined);
      const lineCents = l.chargeCents * l.units;
      at(50, dollars(lineCents, 8), i === 0 ? "24F" : undefined);
      at(58, centsOf(lineCents));
      at(61, String(l.units), i === 0 ? "24G" : undefined);
      at(70, l.renderingNpi, i === 0 ? "24J" : undefined);
      // The shaded line above: a drug's NDC with its unit and quantity (N4, then the 11 digits, a space, unit and quantity).
      if (l.ndc) page.push({ line: line - 1, col: 1, text: `N4${l.ndc} ${(l.ndcUnit ?? "UN").toUpperCase()}${l.ndcQuantity ?? 1}` });
    });
    // 28 total and 29 amount paid, on the last form only
    if (last) {
      page.push({ line: 57, col: 51, text: dollars(c.totalCents, 7), box: "28" }, { line: 57, col: 58, text: centsOf(c.totalCents) });
      if (c.paidCents > 0) page.push({ line: 57, col: 62, text: dollars(c.paidCents, 7), box: "29" }, { line: 57, col: 69, text: centsOf(c.paidCents) });
    } else {
      page.push({ line: 57, col: 51, text: "CONTINUED", box: "28" });
    }
    return page;
  });
}
