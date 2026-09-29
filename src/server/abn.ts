/**
 * Advance Beneficiary Notices (ABN, form CMS-R-131). Before a service Medicare
 * may not cover, the patient is told in writing and chooses: option 1, bill
 * Medicare and pay if it denies; option 2, do not bill Medicare and pay now;
 * option 3, do not have the service. The claim then says so: GA on a line with
 * a signed ABN, GZ when there is none (the patient cannot then be billed).
 *
 * CMS requires its approved form, unmodified; this records the notice, fills
 * in what the form asks for, and keeps the claims consistent with it.
 */
import { and, desc, eq, lte, gte } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ScrubFinding } from "@/lib/scrub/rules";

const { abns, auditLog } = schema;

export type AbnService = { code: string; description: string; estimatedCents: number };
export const ABN_OPTIONS: Record<number, string> = {
  1: "Option 1: provide the service, bill Medicare; the patient pays if Medicare does not",
  2: "Option 2: provide the service, do not bill Medicare; the patient pays now",
  3: "Option 3: the patient does not want the service",
};

/** "82947, Glucose test, 25.00" lines into services. */
export function parseAbnServices(text: string): AbnService[] {
  const out: AbnService[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const parts = line.split(",").map((p) => p.trim());
    const code = (parts[0] ?? "").toUpperCase();
    const cost = Number((parts[parts.length - 1] ?? "").replace(/[$,\s]/g, ""));
    const description = parts.slice(1, parts.length > 2 ? -1 : undefined).join(", ");
    if (!/^[0-9A-Z]{5}$/.test(code)) throw new Error(`${code || "(blank)"} is not a procedure code`);
    if (!description) throw new Error(`${code}: describe the service in words the patient understands`);
    out.push({ code, description: description.slice(0, 120), estimatedCents: parts.length > 2 && Number.isFinite(cost) && cost >= 0 ? Math.round(cost * 100) : 0 });
  }
  if (!out.length) throw new Error("List at least one service");
  return out;
}

export async function createAbn(db: Db, practiceId: string, input: { patientId: string; serviceDate: string; services: AbnService[]; reason: string }, userId?: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)) throw new Error("Enter the date of service");
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new Error("Say why Medicare may not pay (for example: Medicare pays for this test only once a year)");
  const [row] = await db.insert(abns).values({ practiceId, patientId: input.patientId, serviceDate: input.serviceDate, services: input.services, reason, createdBy: userId ?? null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "abn_created", entity: "patient", entityId: input.patientId, details: { abnId: row.id } });
  return row;
}

/** The patient's choice and the date they signed. */
export async function recordAbnChoice(db: Db, practiceId: string, id: string, option: number, signedOn: string, userId?: string) {
  if (![1, 2, 3].includes(option)) throw new Error("Choose the option the patient checked");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(signedOn)) throw new Error("Enter the date the patient signed");
  const [row] = await db.update(abns).set({ option, signedOn }).where(and(eq(abns.id, id), eq(abns.practiceId, practiceId))).returning();
  if (!row) throw new Error("Notice not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "abn_signed", entity: "patient", entityId: row.patientId, details: { abnId: id, option } });
  return row;
}

export async function listAbns(db: Db, practiceId: string, patientId: string) {
  return db.select().from(abns).where(and(eq(abns.practiceId, practiceId), eq(abns.patientId, patientId))).orderBy(desc(abns.serviceDate));
}

/** Signed notices that cover a date of service (signed on or before it, for services that day or within a year for a repeated service). */
async function signedFor(db: Db, patientId: string, dateOfService: string) {
  const yearBefore = new Date(Date.parse(`${dateOfService}T12:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  return db.select().from(abns).where(and(eq(abns.patientId, patientId), lte(abns.signedOn, dateOfService), gte(abns.serviceDate, yearBefore), lte(abns.serviceDate, dateOfService)));
}

/** Modifiers a Medicare line should carry given the patient's notices: GA with a signed option 1. */
export async function abnModifiers(db: Db, patientId: string, dateOfService: string, lines: { cpt: string; modifiers: string[] }[]) {
  const signed = (await signedFor(db, patientId, dateOfService)).filter((a) => a.option === 1);
  return lines.map((l) => {
    const covered = signed.some((a) => a.services.some((s) => s.code === l.cpt.toUpperCase()));
    const mods = l.modifiers.map((m) => m.toUpperCase());
    return covered && !mods.includes("GA") ? [...mods.filter((m) => m !== "GZ"), "GA"] : mods;
  });
}

/** Claim checks: GA without a signed notice, a notice whose patient chose not to bill Medicare, and a signed notice without GA. */
export async function abnFindings(db: Db, c: { patientId: string; payerType: string; dateOfService: string; lines: { lineNumber: number; cpt: string; modifiers: string[] }[] }): Promise<ScrubFinding[]> {
  if (c.payerType !== "medicare") return [];
  const signed = await signedFor(db, c.patientId, c.dateOfService);
  const out: ScrubFinding[] = [];
  for (const l of c.lines) {
    const code = l.cpt.toUpperCase();
    const mods = l.modifiers.map((m) => m.toUpperCase());
    const notice = signed.find((a) => a.services.some((s) => s.code === code));
    const field = `lines.${l.lineNumber}.modifiers`;
    if (notice?.option === 2) out.push({ rule: "ABN_OPTION_2", severity: "error", field, message: `Line ${l.lineNumber}: the patient chose on the ABN not to have Medicare billed for ${code}; collect from the patient and remove the line` });
    else if (mods.includes("GA") && notice?.option !== 1) out.push({ rule: "ABN_MISSING", severity: "error", field, message: `Line ${l.lineNumber}: GA says a signed ABN is on file for ${code}, but none is recorded for this date of service` });
    else if (notice?.option === 1 && !mods.includes("GA")) out.push({ rule: "ABN_GA", severity: "warning", field, message: `Line ${l.lineNumber}: a signed ABN covers ${code}; add GA so the patient can be billed if Medicare denies` });
  }
  return out;
}
