/**
 * Administration: the practice's own details (what goes on every claim as the
 * billing provider), its providers and payers, the menu, and ending sessions.
 * Every change is written to the audit log with what it was before.
 */
import { and, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { isValidNpi } from "@/lib/scrub/rules";
import { NAV_GROUPS } from "@/lib/nav";

const { practices, providers, payers, users, auditLog } = schema;

const STATE = /^[A-Z]{2}$/;
const ZIP = /^\d{5}(-?\d{4})?$/;
const TAX_ID = /^\d{2}-?\d{7}$/;
const TAXONOMY = /^\d{3}[0-9A-Z]{6}X$/;
const PHONE = /^\+?1?[\s.-]?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/;

const log = (db: Db, practiceId: string, userId: string | undefined, action: string, entity: string, entityId: string, details: Record<string, unknown>) =>
  db.insert(auditLog).values({ practiceId, userId: userId ?? null, action, entity, entityId, details });

/** Only fields that changed, as before/after pairs, for the audit log. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(after).filter((k) => before[k] !== after[k]).map((k) => [k, { from: before[k] ?? null, to: after[k] ?? null }]));
}

/* ------------------------------ Practice profile ------------------------------ */

export type ProfileInput = { name: string; npi: string; taxId: string; address1: string; city: string; state: string; zip: string; phone: string };

export async function saveProfile(db: Db, practiceId: string, input: ProfileInput, userId?: string) {
  const v = {
    name: input.name.trim().slice(0, 120), npi: input.npi.replace(/\D/g, ""), taxId: input.taxId.trim(), address1: input.address1.trim().slice(0, 120),
    city: input.city.trim().slice(0, 60), state: input.state.trim().toUpperCase(), zip: input.zip.trim(), phone: input.phone.trim() || null,
  };
  if (!v.name) throw new Error("Enter the practice's legal name");
  if (!isValidNpi(v.npi)) throw new Error("That NPI fails its check digit; claims would be rejected");
  if (!TAX_ID.test(v.taxId)) throw new Error("Enter the tax ID as nine digits, e.g. 12-3456789");
  if (!v.address1 || !v.city) throw new Error("Enter the street address and city (claims need a physical address, not a PO box)");
  if (/^p\.?\s*o\.?\s*box/i.test(v.address1)) throw new Error("The billing provider address must be a street address, not a PO box");
  if (!STATE.test(v.state)) throw new Error("Enter the two-letter state");
  if (!ZIP.test(v.zip)) throw new Error("Enter a five- or nine-digit ZIP code");
  if (v.phone && !PHONE.test(v.phone)) throw new Error("Enter a US phone number");
  const [before] = await db.select().from(practices).where(eq(practices.id, practiceId)).limit(1);
  await db.update(practices).set(v).where(eq(practices.id, practiceId));
  await log(db, practiceId, userId, "practice_profile_changed", "practice", practiceId, diff(before as unknown as Record<string, unknown>, v));
}

/* ------------------------------ Providers ------------------------------ */

export type ProviderInput = { firstName: string; lastName: string; npi: string; taxonomy: string; specialty: string };

function cleanProvider(input: ProviderInput) {
  const v = { firstName: input.firstName.trim().slice(0, 60), lastName: input.lastName.trim().slice(0, 60), npi: input.npi.replace(/\D/g, ""), taxonomy: input.taxonomy.trim().toUpperCase(), specialty: input.specialty.trim().slice(0, 80) };
  if (!v.firstName || !v.lastName) throw new Error("Enter the provider's first and last name");
  if (!isValidNpi(v.npi)) throw new Error("That NPI fails its check digit");
  if (!TAXONOMY.test(v.taxonomy)) throw new Error("Enter the 10-character taxonomy code, e.g. 207Q00000X");
  if (!v.specialty) throw new Error("Enter the specialty");
  return v;
}

export async function saveProvider(db: Db, practiceId: string, id: string | null, input: ProviderInput, userId?: string) {
  const v = cleanProvider(input);
  const [dupe] = await db.select({ id: providers.id }).from(providers).where(and(eq(providers.practiceId, practiceId), eq(providers.npi, v.npi))).limit(1);
  if (dupe && dupe.id !== id) throw new Error("Another provider here already has that NPI");
  if (id) {
    const [before] = await db.select().from(providers).where(and(eq(providers.id, id), eq(providers.practiceId, practiceId))).limit(1);
    if (!before) throw new Error("Provider not found");
    await db.update(providers).set(v).where(eq(providers.id, id));
    await log(db, practiceId, userId, "provider_changed", "provider", id, diff(before as unknown as Record<string, unknown>, v));
    return id;
  }
  const [row] = await db.insert(providers).values({ practiceId, ...v }).returning();
  await log(db, practiceId, userId, "provider_added", "provider", row.id, { npi: v.npi });
  return row.id;
}

/** Inactive providers keep their history but leave charge entry and scheduling pickers. */
export async function setProviderActive(db: Db, practiceId: string, id: string, active: boolean, userId?: string) {
  const [p] = await db.update(providers).set({ active }).where(and(eq(providers.id, id), eq(providers.practiceId, practiceId))).returning();
  if (!p) throw new Error("Provider not found");
  await log(db, practiceId, userId, active ? "provider_activated" : "provider_deactivated", "provider", id, {});
}

/* ------------------------------ Payers ------------------------------ */

export const PAYER_TYPES = ["commercial", "medicare", "medicaid", "self_pay"];
export type PayerInput = { name: string; payerId: string; type: string; timelyFilingDays: number; appealDays: number };

export async function savePayer(db: Db, practiceId: string, id: string | null, input: PayerInput, userId?: string) {
  const v = { name: input.name.trim().slice(0, 120), payerId: input.payerId.trim().toUpperCase().slice(0, 20), type: input.type, timelyFilingDays: Math.round(input.timelyFilingDays), appealDays: Math.round(input.appealDays) };
  if (!v.name) throw new Error("Enter the payer's name");
  if (!/^[A-Z0-9]{2,20}$/.test(v.payerId)) throw new Error("Enter the clearinghouse payer ID (letters and digits)");
  if (!PAYER_TYPES.includes(v.type)) throw new Error("Choose the payer type");
  if (!(v.timelyFilingDays >= 30 && v.timelyFilingDays <= 730)) throw new Error("Timely filing is 30 to 730 days");
  if (!(v.appealDays >= 15 && v.appealDays <= 365)) throw new Error("The appeal window is 15 to 365 days");
  if (id) {
    const [before] = await db.select().from(payers).where(and(eq(payers.id, id), eq(payers.practiceId, practiceId))).limit(1);
    if (!before) throw new Error("Payer not found");
    await db.update(payers).set(v).where(eq(payers.id, id));
    await log(db, practiceId, userId, "payer_changed", "payer", id, diff(before as unknown as Record<string, unknown>, v));
    return id;
  }
  const [row] = await db.insert(payers).values({ practiceId, ...v }).returning();
  await log(db, practiceId, userId, "payer_added", "payer", row.id, { payerId: v.payerId });
  return row.id;
}

/* ------------------------------ Menu ------------------------------ */

/** Pages that are always in the menu: the home page and the way back to these settings. */
export const ALWAYS_SHOWN = ["/dashboard", "/settings"];

export async function setHiddenNav(db: Db, practiceId: string, hrefs: string[], userId?: string) {
  const known = new Set(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)));
  const hidden = [...new Set(hrefs)].filter((h) => known.has(h) && !ALWAYS_SHOWN.includes(h));
  await db.update(practices).set({ hiddenNav: hidden }).where(eq(practices.id, practiceId));
  await log(db, practiceId, userId, "menu_changed", "practice", practiceId, { hidden: hidden.length });
  return hidden;
}

/* ------------------------------ Sessions ------------------------------ */

/** Ends every session in the practice that began before now. */
export async function revokeAllSessions(db: Db, practiceId: string, userId?: string) {
  await db.update(practices).set({ sessionsRevokedAt: new Date() }).where(eq(practices.id, practiceId));
  await log(db, practiceId, userId, "sessions_revoked", "practice", practiceId, { scope: "everyone" });
}

/** Ends one person's sessions, everywhere. */
export async function revokeUserSessions(db: Db, practiceId: string, targetUserId: string, userId?: string) {
  await db.update(users).set({ sessionsRevokedAt: new Date() }).where(eq(users.id, targetUserId));
  await log(db, practiceId, userId, "sessions_revoked", "user", targetUserId, { scope: "user" });
}

/* ------------------------------ Patient financing ------------------------------ */

/** The practice's own financing lender, shown in the portal for balances at or above the minimum. Null turns it off. */
export async function saveFinancing(db: Db, practiceId: string, input: { lender: string; url: string; minCents: number } | null, userId?: string) {
  let value: { lender: string; url: string; minCents: number } | null = null;
  if (input) {
    const lender = input.lender.trim().slice(0, 80);
    const url = input.url.trim();
    if (!lender) throw new Error("Enter the lender's name");
    if (!/^https:\/\/[^\s]+$/.test(url)) throw new Error("Enter the lender's application link (https)");
    if (!Number.isInteger(input.minCents) || input.minCents < 0) throw new Error("Enter the minimum balance");
    value = { lender, url, minCents: input.minCents };
  }
  await db.update(practices).set({ financing: value }).where(eq(practices.id, practiceId));
  await log(db, practiceId, userId, "financing_changed", "practice", practiceId, { on: !!value, lender: value?.lender ?? null });
}
