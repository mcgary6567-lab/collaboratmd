/**
 * What a practice has set up and what is left: the settings overview and the
 * onboarding guide on the dashboard both read this.
 */
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { isValidNpi } from "@/lib/scrub/rules";
import { practiceConfig } from "./integrations";
import { getSso } from "./sso";

export type Check = { key: string; label: string; state: "ok" | "todo" | "info"; detail: string; href: string; action: string };

export async function setupHealth(db: Db, practiceId: string): Promise<Check[]> {
  const since = new Date(Date.now() - 26 * 3_600_000);
  const [[practice], [providers], [payers], [noMfa], [runs], ncci, cfg, sso, [claimsSent]] = await Promise.all([
    db.select().from(schema.practices).where(eq(schema.practices.id, practiceId)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.providers).where(and(eq(schema.providers.practiceId, practiceId), eq(schema.providers.active, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.payers).where(eq(schema.payers.practiceId, practiceId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(and(eq(schema.users.practiceId, practiceId), isNull(schema.users.mfaSecret), isNull(schema.users.disabledAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.automationRuns).where(and(eq(schema.automationRuns.practiceId, practiceId), gte(schema.automationRuns.ranAt, since))),
    db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ncci_ptp LIMIT 1) x`).then((r) => Number(r.rows[0]?.n ?? 0)),
    practiceConfig(db, practiceId),
    getSso(db, practiceId),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.claims).where(and(eq(schema.claims.practiceId, practiceId), sql`${schema.claims.submittedAt} IS NOT NULL`)),
  ]);
  const p = practice.policies ?? {};
  const policiesOn = [p.writeOffLimitCents != null, p.strictScrub, p.riskHoldScore != null, p.smallBalanceCents != null, p.exportsAdminOnly, p.refundDualControl].filter(Boolean).length;
  const profileOk = isValidNpi(practice.npi) && /^\d{2}-?\d{7}$/.test(practice.taxId) && !!practice.phone;
  return [
    { key: "profile", label: "Practice profile", state: profileOk ? "ok" : "todo", detail: isValidNpi(practice.npi) ? (practice.phone ? `NPI ${practice.npi}` : "Add a phone number") : "The NPI fails its check digit", href: "/settings/profile", action: "Check the practice's NPI, tax ID and address" },
    { key: "roster", label: "Providers and payers", state: Number(providers.n) && Number(payers.n) ? "ok" : "todo", detail: `${providers.n} active providers, ${payers.n} payers`, href: "/settings/providers", action: "Add your providers and the payers you bill" },
    { key: "clearinghouse", label: "Clearinghouse", state: cfg.stedi ? "ok" : "todo", detail: cfg.stedi ? "Stedi connected: claims go to payers" : "Simulated: connect Stedi to send real claims", href: "/settings/connections", action: "Connect Stedi so claims reach payers and remittances come back" },
    { key: "mfa", label: "Two-factor sign-in", state: practice.requireMfa ? "ok" : "todo", detail: practice.requireMfa ? "Required for everyone" : `Optional; ${noMfa.n} ${Number(noMfa.n) === 1 ? "person is" : "people are"} without it`, href: "/settings/security", action: "Require two-factor sign-in for everyone" },
    { key: "automation", label: "Daily automation", state: Number(runs.n) ? "ok" : "todo", detail: Number(runs.n) ? "Ran in the last day" : "Has not run in the last day (check CRON_SECRET on the server)", href: "/settings/automation", action: "Turn on reminders and follow-up, and make sure the daily job runs" },
    { key: "first_claim", label: "First claim sent", state: Number(claimsSent.n) ? "ok" : "todo", detail: Number(claimsSent.n) ? `${Number(claimsSent.n).toLocaleString("en-US")} claims sent` : "Enter a visit and send its claim", href: "/encounters/new", action: "Enter charges for a visit and send the claim" },
    { key: "policies", label: "Billing policies", state: policiesOn ? "ok" : "info", detail: policiesOn ? `${policiesOn} rule${policiesOn === 1 ? "" : "s"} on` : "None on: limits and approvals are open", href: "/settings/policies", action: "Set write-off limits and approvals" },
    { key: "ncci", label: "National code sets", state: ncci ? "ok" : "info", detail: ncci ? "NCCI edits loaded" : "Not loaded: NCCI checks are skipped", href: "/settings/code-sets", action: "Load the NCCI edits" },
    { key: "sso", label: "Single sign-on", state: sso ? "ok" : "info", detail: sso ? `On for ${sso.domains.join(", ")}` : "Optional: sign in with Okta, Entra ID or Google", href: "/settings/sso", action: "Connect your identity provider" },
  ];
}
