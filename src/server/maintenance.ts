/**
 * Everything in a practice's setup that goes out of date on its own, in one
 * list: charges not reviewed since Medicare's January update, payer contracts
 * nearing their notice date, provider credentials expiring, chargemaster
 * prices not reviewed in a year, the single sign-on certificate, and API keys
 * that are old or unused. Settings, Maintenance shows it; the morning checks
 * (server/daily-checks.ts) notify administrators once per finding.
 *
 * The national pieces (CMS code sets, the HIPAA transaction versions, the
 * runtime the app runs on) are listed with it; see server/code-set-calendar.ts
 * and lib/edi/standards.ts.
 */
import crypto from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { contractCalendar } from "./contract-calendar";
import { credentialState, CREDENTIAL_KINDS, listCredentials } from "./credentials";
import { chargemasterStats } from "./chargemaster";

export type ItemStatus = "ok" | "soon" | "attention";
export type MaintenanceItem = { key: string; label: string; status: ItemStatus; detail: string; href: string };

const DAY = 86_400_000;
const days = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY);

/**
 * Node.js release lines and when each stops getting security fixes (the
 * Node.js release schedule; a release line is supported about 30 months).
 * The monthly maintenance workflow checks the live schedule as well, so a
 * change there is caught even before this table is updated.
 */
export const NODE_END_OF_LIFE: Record<number, string> = { 20: "2026-04-30", 22: "2027-04-30", 24: "2028-04-30", 26: "2029-04-30" };

export function runtimeStatus(version = process.version, now = new Date()) {
  const major = Number(version.replace(/^v/, "").split(".")[0]);
  const eol = NODE_END_OF_LIFE[major] ?? null;
  if (!eol) return { major, eol: null, status: "soon" as ItemStatus, detail: `Node.js ${major}: its end of support is not in the app's table; check the Node.js release schedule.` };
  const left = days(now, new Date(`${eol}T00:00:00Z`));
  const status: ItemStatus = left < 0 ? "attention" : left <= 180 ? "soon" : "ok";
  return { major, eol, status, detail: left < 0 ? `Node.js ${major} stopped getting security fixes on ${eol}. Move to the current release line.` : `Node.js ${major} gets security fixes until ${eol}${status === "soon" ? `: plan the move to the next release line (${left} days left)` : ""}.` };
}

/** When an X.509 certificate stops being valid; null if it cannot be read. */
export function certificateExpiry(pemOrBase64: string): Date | null {
  try {
    const body = pemOrBase64.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "").replace(/\s+/g, "");
    return new Date(new crypto.X509Certificate(Buffer.from(body, "base64")).validTo);
  } catch {
    return null;
  }
}

export async function practiceMaintenance(db: Db, practiceId: string, now = new Date()): Promise<MaintenanceItem[]> {
  const today = now.toISOString().slice(0, 10);
  const items: MaintenanceItem[] = [];

  // Standard charges: reviewed since the last January, when Medicare's rates change.
  const [fees] = (await db.execute<{ changed: string | null; schedules: string }>(sql`
    SELECT (SELECT to_char(max(at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') FROM audit_log WHERE practice_id = ${practiceId} AND action = 'save_fee_schedule') AS changed,
      (SELECT count(*)::text FROM fee_schedules WHERE practice_id = ${practiceId} AND active) AS schedules`)).rows;
  const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const changed = fees?.changed ? new Date(fees.changed) : null;
  if (Number(fees?.schedules ?? 0) === 0) items.push({ key: "fees", label: "Fee schedules", status: "attention", detail: "No fee schedule yet: claims need your standard charges.", href: "/settings/fees" });
  else items.push({
    key: "fees", label: "Fee schedules",
    status: !changed || changed < jan1 ? (now.getUTCMonth() >= 2 ? "attention" : "soon") : "ok",
    detail: changed ? `Last changed ${changed.toISOString().slice(0, 10)}. ${changed < jan1 ? "Medicare's rates changed on January 1: review your standard charges and contract rates." : "Reviewed since Medicare's January update."}` : "Not changed since it was set up: review your charges against this year's Medicare rates.",
    href: "/settings/fees",
  });

  // Payer contracts: the notice window before renewal.
  const contracts = (await contractCalendar(db, practiceId, today)).filter((c) => c.renewsOn);
  const pastNotice = contracts.filter((c) => c.daysToNotice !== null && c.daysToNotice < 0 && c.renewsOn! >= today);
  const nearNotice = contracts.filter((c) => c.daysToNotice !== null && c.daysToNotice >= 0 && c.daysToNotice <= 60);
  items.push({
    key: "contracts", label: "Payer contracts",
    status: pastNotice.length ? "attention" : nearNotice.length ? "soon" : "ok",
    detail: contracts.length === 0 ? "No renewal dates recorded. Add them so notice deadlines are not missed." : pastNotice.length ? `${pastNotice.length} past the notice date for renegotiating before renewal.` : nearNotice.length ? `${nearNotice.length} reach their notice date within 60 days.` : `${contracts.length} with renewal dates; none due soon.`,
    href: "/reports/contract-calendar",
  });

  // Provider credentials.
  const creds = await listCredentials(db, practiceId);
  const states = creds.map((row) => ({ row, s: credentialState(row.c.expiresOn, today) }));
  const expired = states.filter((x) => x.s === "expired");
  const due = states.filter((x) => x.s === "due");
  items.push({
    key: "credentials", label: "Provider licenses and credentials",
    status: expired.length ? "attention" : due.length ? "soon" : "ok",
    detail: expired.length ? `${expired.length} expired: ${expired.slice(0, 3).map((x) => CREDENTIAL_KINDS[x.row.c.kind] ?? x.row.c.kind).join(", ")}.` : due.length ? `${due.length} expire within 60 days.` : creds.length ? `${creds.length} on file, none expiring within 60 days.` : "None recorded.",
    href: "/settings/credentials",
  });

  // Chargemaster (facilities only).
  const cdm = await chargemasterStats(db, practiceId);
  if (cdm.items > 0) items.push({ key: "chargemaster", label: "Chargemaster prices", status: cdm.unreviewed ? "attention" : "ok", detail: cdm.unreviewed ? `${cdm.unreviewed} of ${cdm.items} items not reviewed in the last year.` : "Every item reviewed in the last year.", href: "/settings/chargemaster" });

  // Single sign-on certificate.
  const [sso] = await db.select().from(schema.practiceSso).where(eq(schema.practiceSso.practiceId, practiceId)).limit(1);
  if (sso?.protocol === "saml" && sso.samlIdpCert) {
    const until = certificateExpiry(sso.samlIdpCert);
    const left = until ? days(now, until) : null;
    items.push({
      key: "saml", label: "Single sign-on certificate",
      status: left === null ? "attention" : left < 0 ? "attention" : left <= 30 ? "soon" : "ok",
      detail: left === null ? "The identity provider's certificate cannot be read." : left < 0 ? `Expired on ${until!.toISOString().slice(0, 10)}: single sign-on fails until the new certificate is saved.` : `Valid until ${until!.toISOString().slice(0, 10)}${left <= 30 ? `: save your identity provider's new certificate before then` : ""}.`,
      href: "/settings/sso",
    });
  }

  // API keys: rotate yearly, revoke unused ones.
  const keys = await db.select().from(schema.apiKeys).where(and(eq(schema.apiKeys.practiceId, practiceId), isNull(schema.apiKeys.revokedAt)));
  if (keys.length) {
    const old = keys.filter((k) => days(k.createdAt, now) > 365);
    const unused = keys.filter((k) => days(k.lastUsedAt ?? k.createdAt, now) > 90);
    items.push({
      key: "api-keys", label: "API keys",
      status: old.length || unused.length ? "soon" : "ok",
      detail: [old.length ? `${old.length} older than a year: replace them` : null, unused.length ? `${unused.length} unused for 90 days: revoke them if nothing needs them` : null].filter(Boolean).join("; ") || `${keys.length} active, all recent and in use.`,
      href: "/settings/developers",
    });
  }
  return items;
}
