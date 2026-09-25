/**
 * The compliance center: a readiness checklist evaluated from how the
 * practice is actually configured, periodic access reviews, a register of
 * business associate agreements with the vendors that touch its data, and
 * the audit log.
 *
 * This supports HIPAA Security Rule and SOC 2 preparation; it does not make
 * anyone compliant or certified. Policies, training, risk analysis and an
 * auditor's opinion are outside what software can check.
 */
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { practiceConfig } from "./integrations";

const { users, practices, practiceMemberships, auditLog, accessReviews, vendorAgreements } = schema;

const DAY = 86_400_000;

export async function practiceUsers(db: Db, practiceId: string) {
  const home = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, mfaEnabledAt: users.mfaEnabledAt, lockedUntil: users.lockedUntil, createdAt: users.createdAt }).from(users).where(eq(users.practiceId, practiceId));
  const members = await db
    .select({ id: users.id, name: users.name, email: users.email, role: practiceMemberships.role, mfaEnabledAt: users.mfaEnabledAt, lockedUntil: users.lockedUntil, createdAt: users.createdAt })
    .from(practiceMemberships)
    .innerJoin(users, eq(users.id, practiceMemberships.userId))
    .where(eq(practiceMemberships.practiceId, practiceId));
  const all = [...new Map([...home, ...members].map((u) => [u.id, u])).values()];
  const logins = all.length
    ? await db.select({ userId: auditLog.userId, last: sql<Date>`max(${auditLog.at})` }).from(auditLog).where(and(eq(auditLog.action, "login"), inArray(auditLog.userId, all.map((u) => u.id)))).groupBy(auditLog.userId)
    : [];
  const last = new Map(logins.map((l) => [l.userId, l.last ? new Date(l.last) : null]));
  return all.map((u) => ({ ...u, lastLogin: last.get(u.id) ?? null })).sort((a, b) => a.name.localeCompare(b.name));
}

/* ------------------------------ Vendors ------------------------------ */

export const BAA_STATUSES = ["signed", "pending", "not_needed", "not_recorded"] as const;

/** The vendors this deployment and practice actually use, so the register starts from facts rather than a template. */
export async function detectedVendors(db: Db, practiceId: string) {
  const cfg = await practiceConfig(db, practiceId);
  const out: { vendor: string; service: string; handlesPhi: boolean }[] = [];
  if (process.env.VERCEL) out.push({ vendor: "Vercel", service: "Application hosting", handlesPhi: true });
  const dbHost = (() => { try { return new URL(process.env.DATABASE_URL ?? "").hostname; } catch { return ""; } })();
  if (dbHost.endsWith("neon.tech")) out.push({ vendor: "Neon", service: "Database hosting", handlesPhi: true });
  if (cfg.stedi) out.push({ vendor: "Stedi", service: "Clearinghouse: claims, eligibility, remittances", handlesPhi: true });
  if (cfg.stripe) out.push({ vendor: "Stripe", service: "Card payments", handlesPhi: false });
  if (cfg.twilio) out.push({ vendor: "Twilio", service: "Text messages to patients", handlesPhi: true });
  if (cfg.resend) out.push({ vendor: "Resend", service: "Email to patients and staff", handlesPhi: true });
  if (cfg.anthropic) out.push({ vendor: "Anthropic", service: cfg.anthropic.phiAllowed ? "AI, including visit notes" : "AI on codes only (no patient identifiers)", handlesPhi: cfg.anthropic.phiAllowed });
  return out;
}

export async function listVendors(db: Db, practiceId: string) {
  const detected = await detectedVendors(db, practiceId);
  const existing = await db.select().from(vendorAgreements).where(eq(vendorAgreements.practiceId, practiceId));
  const missing = detected.filter((d) => !existing.some((e) => e.vendor === d.vendor));
  if (missing.length) {
    await db.insert(vendorAgreements).values(missing.map((m) => ({ practiceId, ...m }))).onConflictDoNothing();
    return db.select().from(vendorAgreements).where(eq(vendorAgreements.practiceId, practiceId)).orderBy(vendorAgreements.vendor);
  }
  return existing.sort((a, b) => a.vendor.localeCompare(b.vendor));
}

export async function saveVendor(db: Db, practiceId: string, input: { id?: string | null; vendor: string; service: string; handlesPhi: boolean; baaStatus: string; signedOn?: string | null; notes?: string | null }, userId?: string) {
  const vendor = input.vendor.trim().slice(0, 80);
  if (!vendor) throw new Error("Name the vendor");
  if (!BAA_STATUSES.includes(input.baaStatus as (typeof BAA_STATUSES)[number])) throw new Error("Choose the agreement status");
  if (input.baaStatus === "signed" && !/^\d{4}-\d{2}-\d{2}$/.test(input.signedOn ?? "")) throw new Error("Enter the date the BAA was signed");
  const values = { vendor, service: input.service.trim().slice(0, 200) || "Not described", handlesPhi: input.handlesPhi, baaStatus: input.baaStatus, signedOn: input.baaStatus === "signed" ? input.signedOn! : null, notes: input.notes?.trim().slice(0, 1000) || null, updatedBy: userId ?? null, updatedAt: new Date() };
  if (input.id) await db.update(vendorAgreements).set(values).where(and(eq(vendorAgreements.id, input.id), eq(vendorAgreements.practiceId, practiceId)));
  else await db.insert(vendorAgreements).values({ practiceId, ...values }).onConflictDoUpdate({ target: [vendorAgreements.practiceId, vendorAgreements.vendor], set: values });
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "vendor_agreement_saved", entity: "vendor", entityId: vendor, details: { baaStatus: input.baaStatus } });
}

/* ------------------------------ Access reviews ------------------------------ */

export async function recordAccessReview(db: Db, practiceId: string, notes: string, userId?: string) {
  const people = await practiceUsers(db, practiceId);
  const [row] = await db.insert(accessReviews).values({ practiceId, reviewedBy: userId ?? null, usersReviewed: people.length, notes: notes.trim().slice(0, 2000) || null }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "access_review", entity: "practice", entityId: practiceId, details: { usersReviewed: people.length } });
  return row;
}

export async function lastAccessReview(db: Db, practiceId: string) {
  const [row] = await db.select().from(accessReviews).where(eq(accessReviews.practiceId, practiceId)).orderBy(desc(accessReviews.createdAt)).limit(1);
  return row ?? null;
}

/* ------------------------------ Controls ------------------------------ */

export type Control = { key: string; area: string; title: string; status: "pass" | "warn" | "fail"; detail: string; href?: string };

export async function evaluateControls(db: Db, practiceId: string, now = new Date()): Promise<Control[]> {
  const [[practice], people, review, vendors, [{ n: events }]] = await Promise.all([
    db.select().from(practices).where(eq(practices.id, practiceId)).limit(1),
    practiceUsers(db, practiceId),
    lastAccessReview(db, practiceId),
    listVendors(db, practiceId),
    db.select({ n: sql<number>`count(*)::int` }).from(auditLog).where(and(eq(auditLog.practiceId, practiceId), gte(auditLog.at, new Date(now.getTime() - 30 * DAY)))),
  ]);
  const withMfa = people.filter((u) => u.mfaEnabledAt).length;
  const admins = people.filter((u) => u.role === "admin").length;
  const dormant = people.filter((u) => !u.lastLogin || now.getTime() - u.lastLogin.getTime() > 90 * DAY).length;
  const phiVendors = vendors.filter((v) => v.handlesPhi);
  const unsigned = phiVendors.filter((v) => v.baaStatus !== "signed");
  const reviewAge = review ? Math.floor((now.getTime() - review.createdAt.getTime()) / DAY) : null;
  const productionKey = !!process.env.AUTH_SECRET?.trim() && (process.env.AUTH_SECRET?.trim().length ?? 0) >= 32;

  return [
    { key: "mfa_required", area: "Access control", title: "Two-factor sign-in required for everyone", status: practice.requireMfa ? "pass" : "fail", detail: practice.requireMfa ? "Every user must sign in with an authenticator code." : "Turn on \"Require two-factor sign-in\" for the practice.", href: "/settings/security" },
    { key: "mfa_enrolled", area: "Access control", title: "Users enrolled in two-factor sign-in", status: withMfa === people.length ? "pass" : withMfa > 0 ? "warn" : "fail", detail: `${withMfa} of ${people.length} users have an authenticator set up.`, href: "/settings/security" },
    { key: "least_privilege", area: "Access control", title: "Few administrators", status: admins <= 3 ? "pass" : "warn", detail: `${admins} administrator${admins === 1 ? "" : "s"}.${admins > 3 ? " Give billing and front-desk staff their narrower roles." : ""}`, href: "/settings" },
    { key: "dormant", area: "Access control", title: "No dormant accounts", status: dormant === 0 ? "pass" : "warn", detail: dormant ? `${dormant} user${dormant === 1 ? " has" : "s have"} not signed in for 90 days. Remove access that is no longer needed.` : "Everyone with access has signed in within 90 days." },
    { key: "access_review", area: "Access control", title: "Access reviewed in the last 90 days", status: reviewAge !== null && reviewAge <= 90 ? "pass" : "fail", detail: review ? `Last review ${reviewAge} days ago, ${review.usersReviewed} users.` : "No access review recorded yet. Review the users below and record it." },
    { key: "lockout", area: "Access control", title: "Accounts lock after failed sign-ins", status: "pass", detail: "Built in: 15 minutes after 5 failed attempts." },
    { key: "encryption_key", area: "Encryption", title: "Strong application encryption key", status: productionKey ? "pass" : "fail", detail: productionKey ? "AUTH_SECRET is set; sessions and stored integration keys are protected by it." : "Set AUTH_SECRET to a random value of at least 32 characters in the hosting environment." },
    { key: "transit", area: "Encryption", title: "Encrypted connections", status: "pass", detail: "HTTPS to the application and a certificate-verified TLS connection to the database." },
    { key: "secrets_hashed", area: "Encryption", title: "Links, API keys and recovery codes stored as hashes", status: "pass", detail: "Built in: a database copy yields no working links or keys." },
    { key: "audit", area: "Audit", title: "Audit log recording activity", status: Number(events) > 0 ? "pass" : "warn", detail: `${Number(events).toLocaleString("en-US")} events in the last 30 days, exportable as CSV below.` },
    { key: "baa", area: "Vendors", title: "BAAs with every vendor that handles patient data", status: phiVendors.length && !unsigned.length ? "pass" : unsigned.some((v) => v.baaStatus === "not_recorded") ? "fail" : "warn", detail: unsigned.length ? `No signed BAA recorded for: ${unsigned.map((v) => v.vendor).join(", ")}.` : phiVendors.length ? "A signed BAA is recorded for each." : "Add the vendors that handle patient data." },
    { key: "ai_phi", area: "Vendors", title: "AI kept away from patient identifiers", status: "pass", detail: "Built in: denial explanations, appeals and imports send codes or column shapes only; visit notes only with a BAA confirmed." },
  ];
}

export async function auditEvents(db: Db, practiceId: string, filters: { action?: string; userId?: string; since?: string; limit?: number } = {}) {
  const where = [eq(auditLog.practiceId, practiceId)];
  if (filters.action) where.push(eq(auditLog.action, filters.action));
  if (filters.userId && /^[0-9a-f-]{36}$/i.test(filters.userId)) where.push(eq(auditLog.userId, filters.userId));
  if (filters.since && /^\d{4}-\d{2}-\d{2}$/.test(filters.since)) where.push(gte(auditLog.at, new Date(filters.since)));
  return db
    .select({ event: auditLog, userName: users.name, userEmail: users.email })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(...where))
    .orderBy(desc(auditLog.at))
    .limit(Math.min(filters.limit ?? 200, 50_000));
}

export async function auditActions(db: Db, practiceId: string) {
  const rows = await db.selectDistinct({ action: auditLog.action }).from(auditLog).where(eq(auditLog.practiceId, practiceId));
  return rows.map((r) => r.action).sort();
}
