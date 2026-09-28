/**
 * Where a practice sees patients. A visit at a location other than the billing
 * address carries that location on its claim as the service facility (837
 * loop 2310C), which payers use for pricing and for place-of-service checks.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { isValidNpi } from "@/lib/scrub/rules";
import { isUsState } from "@/lib/us";
import { POS_CODES } from "@/lib/codes/pos";

const { locations, auditLog } = schema;

export async function listLocations(db: Db, practiceId: string, opts: { activeOnly?: boolean } = {}) {
  const rows = await db.select().from(locations).where(eq(locations.practiceId, practiceId)).orderBy(asc(locations.name));
  return opts.activeOnly ? rows.filter((l) => l.active) : rows;
}

export type LocationInput = { name: string; npi?: string | null; address1: string; city: string; state: string; zip: string; placeOfService?: string | null };

export function validateLocation(input: LocationInput) {
  const v = {
    name: input.name.trim().slice(0, 60),
    npi: input.npi?.replace(/\D/g, "") || null,
    address1: input.address1.trim().slice(0, 55),
    city: input.city.trim().slice(0, 30),
    state: input.state.trim().toUpperCase(),
    zip: input.zip.replace(/[^\d]/g, ""),
    placeOfService: (input.placeOfService ?? "11").trim() || "11",
  };
  if (!v.name) throw new Error("Give the location a name");
  if (v.npi && !isValidNpi(v.npi)) throw new Error("That NPI is not valid (10 digits with a correct check digit)");
  if (!v.address1 || !v.city) throw new Error("Enter the street address and city");
  if (!isUsState(v.state)) throw new Error("Choose the state");
  if (!/^\d{5}(\d{4})?$/.test(v.zip)) throw new Error("Enter a 5 or 9 digit ZIP code");
  if (!POS_CODES.has(v.placeOfService)) throw new Error("Choose a place of service from the CMS list, like 11 for office");
  return v;
}

export async function saveLocation(db: Db, practiceId: string, id: string | null, input: LocationInput, userId?: string) {
  const v = validateLocation(input);
  let row;
  if (id) {
    [row] = await db.update(locations).set(v).where(and(eq(locations.id, id), eq(locations.practiceId, practiceId))).returning();
    if (!row) throw new Error("Location not found");
  } else {
    [row] = await db.insert(locations).values({ practiceId, ...v }).returning();
  }
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: id ? "location_updated" : "location_added", entity: "location", entityId: row.id, details: { name: v.name } });
  return row;
}

export async function setLocationActive(db: Db, practiceId: string, id: string, active: boolean, userId?: string) {
  const [row] = await db.update(locations).set({ active }).where(and(eq(locations.id, id), eq(locations.practiceId, practiceId))).returning();
  if (!row) throw new Error("Location not found");
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: active ? "location_activated" : "location_deactivated", entity: "location", entityId: id });
}
