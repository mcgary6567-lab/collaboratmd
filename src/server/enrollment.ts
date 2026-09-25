/**
 * Provider enrollment (credentialing) with each payer: where each
 * application stands, when it took effect and when it must be revalidated.
 * The scrubber uses it to warn before billing a payer the rendering provider
 * is not approved with.
 */
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { assertOwned } from "./tenancy";

const { providerEnrollments, providers, payers, auditLog } = schema;

export const ENROLLMENT_STATUSES = ["not_started", "submitted", "in_process", "approved", "denied", "terminated"] as const;
export type EnrollmentStatus = (typeof ENROLLMENT_STATUSES)[number];
export type Enrollment = typeof providerEnrollments.$inferSelect;

const isoDate = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export async function enrollmentGrid(db: Db, practiceId: string) {
  const [provs, pays, rows] = await Promise.all([
    db.select().from(providers).where(and(eq(providers.practiceId, practiceId), eq(providers.active, true))).orderBy(asc(providers.lastName)),
    db.select().from(payers).where(eq(payers.practiceId, practiceId)).orderBy(asc(payers.name)),
    db.select().from(providerEnrollments).where(eq(providerEnrollments.practiceId, practiceId)),
  ]);
  const byPair = new Map(rows.map((r) => [`${r.providerId}|${r.payerId}`, r]));
  return { providers: provs, payers: pays.filter((p) => p.type !== "self_pay"), get: (providerId: string, payerId: string) => byPair.get(`${providerId}|${payerId}`) ?? null };
}

export type EnrollmentInput = {
  providerId: string;
  payerId: string;
  status: string;
  payerProviderId?: string | null;
  submittedOn?: string | null;
  effectiveOn?: string | null;
  revalidationDue?: string | null;
  notes?: string | null;
};

export async function saveEnrollment(db: Db, practiceId: string, input: EnrollmentInput, userId?: string) {
  if (!ENROLLMENT_STATUSES.includes(input.status as EnrollmentStatus)) throw new Error("Unknown status");
  await assertOwned(db, practiceId, "provider", input.providerId);
  await assertOwned(db, practiceId, "payer", input.payerId);
  if (input.status === "approved" && !isoDate(input.effectiveOn)) throw new Error("Enter the effective date the payer approved");
  const values = {
    status: input.status,
    payerProviderId: input.payerProviderId?.trim() || null,
    submittedOn: isoDate(input.submittedOn),
    effectiveOn: isoDate(input.effectiveOn),
    revalidationDue: isoDate(input.revalidationDue),
    notes: input.notes?.trim().slice(0, 2000) || null,
    updatedAt: new Date(),
  };
  const [row] = await db
    .insert(providerEnrollments)
    .values({ practiceId, providerId: input.providerId, payerId: input.payerId, ...values })
    .onConflictDoUpdate({ target: [providerEnrollments.providerId, providerEnrollments.payerId], set: values })
    .returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "enrollment_saved", entity: "provider_enrollment", entityId: row.id, details: { status: row.status } });
  return row;
}

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

export type EnrollmentAlert = { enrollment: Enrollment; kind: "revalidation_overdue" | "revalidation_due" | "stalled"; message: string };

/** Revalidations due within 90 days (or overdue), and applications pending over 90 days. */
export function alertsFor(rows: Enrollment[], today = new Date().toISOString().slice(0, 10)): EnrollmentAlert[] {
  const out: EnrollmentAlert[] = [];
  for (const e of rows) {
    if (e.status === "approved" && e.revalidationDue) {
      const left = days(today, e.revalidationDue);
      if (left < 0) out.push({ enrollment: e, kind: "revalidation_overdue", message: `Revalidation was due ${-left} days ago; the payer may stop paying.` });
      else if (left <= 90) out.push({ enrollment: e, kind: "revalidation_due", message: `Revalidation due in ${left} days.` });
    }
    if (["submitted", "in_process"].includes(e.status) && e.submittedOn && days(e.submittedOn, today) > 90) {
      out.push({ enrollment: e, kind: "stalled", message: `Pending ${days(e.submittedOn, today)} days since it was submitted; call the payer's enrollment line.` });
    }
  }
  return out;
}

export async function enrollmentAlerts(db: Db, practiceId: string, today?: string) {
  return alertsFor(await db.select().from(providerEnrollments).where(eq(providerEnrollments.practiceId, practiceId)), today);
}

/**
 * A scrubber warning when the tracker says the provider cannot bill this
 * payer for this date. No row means the practice is not tracking the pair,
 * so there is nothing to say.
 */
export function enrollmentFinding(e: Enrollment | null | undefined, dateOfService: string, providerName: string, payerName: string) {
  if (!e) return null;
  const base = { rule: "provider_enrollment", severity: "warning" as const, field: "provider" };
  if (e.status !== "approved") {
    return { ...base, message: `${providerName} is not approved with ${payerName} (enrollment ${e.status.replace(/_/g, " ")}). The payer is likely to deny this claim.` };
  }
  if (e.effectiveOn && dateOfService < e.effectiveOn) {
    return { ...base, message: `${providerName}'s enrollment with ${payerName} starts ${e.effectiveOn}, after this date of service.` };
  }
  return null;
}

export async function enrollmentFor(db: Db, providerId: string, payerId: string) {
  const [row] = await db.select().from(providerEnrollments).where(and(eq(providerEnrollments.providerId, providerId), eq(providerEnrollments.payerId, payerId))).limit(1);
  return row ?? null;
}
