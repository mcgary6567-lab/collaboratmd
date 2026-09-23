/**
 * ASC X12 005010X221A1 (835) Electronic Remittance Advice parser and generator.
 *
 * Parser extracts payment header (BPR/TRN), payer (N1*PR), claim payment
 * loops (CLP) with claim-level and service-level adjustments (CAS) and
 * remark codes (LQ*HE). Generator is used by the mock clearinghouse to
 * simulate payer adjudication.
 */

export interface Adjustment {
  group: "CO" | "PR" | "OA" | "PI" | string;
  reason: string; // CARC
  amountCents: number;
}

export interface RemitServiceLine {
  cpt: string;
  modifiers: string[];
  chargedCents: number;
  paidCents: number;
  units: number;
  adjustments: Adjustment[];
  remarks: string[]; // RARC
}

export interface RemitClaim {
  patientControlNumber: string; // CLP01 - our claim control number
  statusCode: string; // CLP02: 1 processed primary, 2 secondary, 3 tertiary, 4 denied, 22 reversal
  chargedCents: number;
  paidCents: number;
  patientResponsibilityCents: number;
  payerClaimNumber: string;
  adjustments: Adjustment[];
  remarks: string[];
  lines: RemitServiceLine[];
}

export interface Remit835 {
  payerName: string;
  payerId?: string;
  checkNumber: string;
  paymentDate: string; // YYYY-MM-DD
  totalPaidCents: number;
  claims: RemitClaim[];
}

function toCents(v: string | undefined): number {
  if (!v) return 0;
  return Math.round(parseFloat(v) * 100);
}

function isoDate(d8: string | undefined): string {
  if (!d8 || d8.length !== 8) return "";
  return `${d8.slice(0, 4)}-${d8.slice(4, 6)}-${d8.slice(6, 8)}`;
}

export function parseEdi835(raw: string): Remit835 {
  const text = raw.replace(/\r?\n/g, "");
  const segments = text
    .split("~")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split("*"));

  const remit: Remit835 = {
    payerName: "",
    checkNumber: "",
    paymentDate: "",
    totalPaidCents: 0,
    claims: [],
  };

  let current: RemitClaim | null = null;
  let currentLine: RemitServiceLine | null = null;
  let n1Context = "";

  const parseCas = (seg: string[]): Adjustment[] => {
    const group = seg[1];
    const out: Adjustment[] = [];
    for (let i = 2; i + 1 < seg.length; i += 3) {
      if (!seg[i]) break;
      out.push({ group, reason: seg[i], amountCents: toCents(seg[i + 1]) });
    }
    return out;
  };

  for (const seg of segments) {
    const tag = seg[0];
    switch (tag) {
      case "BPR":
        remit.totalPaidCents = toCents(seg[2]);
        remit.paymentDate = isoDate(seg[16]);
        break;
      case "TRN":
        remit.checkNumber = seg[2] ?? "";
        break;
      case "N1":
        n1Context = seg[1];
        if (seg[1] === "PR") {
          remit.payerName = seg[2] ?? "";
          if (seg[3] === "XV" || seg[3] === "PI") remit.payerId = seg[4];
        }
        break;
      case "REF":
        if (n1Context === "PR" && seg[1] === "2U" && !current) remit.payerId = seg[2];
        break;
      case "CLP":
        current = {
          patientControlNumber: seg[1],
          statusCode: seg[2],
          chargedCents: toCents(seg[3]),
          paidCents: toCents(seg[4]),
          patientResponsibilityCents: toCents(seg[5]),
          payerClaimNumber: seg[7] ?? "",
          adjustments: [],
          remarks: [],
          lines: [],
        };
        currentLine = null;
        remit.claims.push(current);
        break;
      case "CAS":
        if (currentLine) currentLine.adjustments.push(...parseCas(seg));
        else if (current) current.adjustments.push(...parseCas(seg));
        break;
      case "SVC": {
        if (!current) break;
        const composite = (seg[1] ?? "").split(":");
        currentLine = {
          cpt: composite[1] ?? "",
          modifiers: composite.slice(2).filter(Boolean),
          chargedCents: toCents(seg[2]),
          paidCents: toCents(seg[3]),
          units: seg[5] ? parseInt(seg[5], 10) : 1,
          adjustments: [],
          remarks: [],
        };
        current.lines.push(currentLine);
        break;
      }
      case "LQ":
        if (seg[1] === "HE") {
          if (currentLine) currentLine.remarks.push(seg[2]);
          else if (current) current.remarks.push(seg[2]);
        }
        break;
      case "SE":
        current = null;
        currentLine = null;
        break;
    }
  }
  return remit;
}

/* ------------------------------------------------------------------ */
/* Generator (used by the mock clearinghouse to simulate payers)        */
/* ------------------------------------------------------------------ */

export interface Gen835Claim {
  patientControlNumber: string;
  payerClaimNumber: string;
  statusCode: string;
  chargedCents: number;
  paidCents: number;
  patientResponsibilityCents: number;
  adjustments: Adjustment[];
  remarks?: string[];
  lines: { cpt: string; chargedCents: number; paidCents: number; units: number; adjustments: Adjustment[]; remarks?: string[] }[];
}

export function buildEdi835(input: {
  payerName: string;
  payerId: string;
  checkNumber: string;
  paymentDate: Date;
  claims: Gen835Claim[];
}): string {
  // A non-finite amount would silently serialize as "NaN" and poison every
  // downstream posting, so reject it at the boundary.
  const money = (c: number) => {
    if (!Number.isFinite(c)) throw new Error(`Cannot serialize non-numeric monetary amount: ${c}`);
    return (c / 100).toFixed(2);
  };
  const d8 = input.paymentDate.toISOString().slice(0, 10).replace(/-/g, "");
  const total = input.claims.reduce((a, c) => a + c.paidCents, 0);
  const s: string[][] = [];
  s.push(["ISA", "00", " ".repeat(10), "00", " ".repeat(10), "ZZ", input.payerId.padEnd(15), "ZZ", "COLLABORATMD".padEnd(15), d8.slice(2), "1200", "^", "00501", "000000001", "0", "P", ":"]);
  s.push(["GS", "HP", input.payerId, "COLLABORATMD", d8, "1200", "1", "X", "005010X221A1"]);
  s.push(["ST", "835", "0001"]);
  s.push(["BPR", "I", money(total), "C", "ACH", "CCP", "01", "999999999", "DA", "123456", "1234567890", "", "01", "999999999", "DA", "654321", d8]);
  s.push(["TRN", "1", input.checkNumber, "1" + input.payerId.padStart(9, "0").slice(-9)]);
  s.push(["DTM", "405", d8]);
  s.push(["N1", "PR", input.payerName]);
  s.push(["REF", "2U", input.payerId]);
  s.push(["N1", "PE", "COLLABORATMD PRACTICE", "XX", "1234567893"]);
  s.push(["LX", "1"]);
  const cas = (a: Adjustment[]) => {
    const grouped = new Map<string, Adjustment[]>();
    for (const adj of a) grouped.set(adj.group, [...(grouped.get(adj.group) ?? []), adj]);
    return [...grouped.entries()].map(([g, list]) => ["CAS", g, ...list.flatMap((x) => [x.reason, money(x.amountCents), ""])]);
  };
  for (const c of input.claims) {
    s.push(["CLP", c.patientControlNumber, c.statusCode, money(c.chargedCents), money(c.paidCents), money(c.patientResponsibilityCents), "12", c.payerClaimNumber, "11", "1"]);
    s.push(...cas(c.adjustments));
    for (const r of c.remarks ?? []) s.push(["LQ", "HE", r]);
    for (const l of c.lines) {
      s.push(["SVC", `HC:${l.cpt}`, money(l.chargedCents), money(l.paidCents), "", String(l.units)]);
      s.push(["DTM", "472", d8]);
      s.push(...cas(l.adjustments));
      for (const r of l.remarks ?? []) s.push(["LQ", "HE", r]);
    }
  }
  s.push(["SE", String(s.length - 2 + 1), "0001"]);
  s.push(["GE", "1", "1"]);
  s.push(["IEA", "1", "000000001"]);
  return s.map((seg) => seg.join("*").replace(/\*+$/, "")).join("~\n") + "~";
}
