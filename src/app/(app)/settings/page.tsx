import Link from "next/link";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { isValidNpi } from "@/lib/scrub/rules";
import { settingsFor } from "@/lib/settings-sections";
import { practiceConfig } from "@/server/integrations";
import { getSso } from "@/server/sso";
import { Badge, Card, PageHeader } from "@/components/ui";
import { SettingsDirectory } from "./settings-directory";

export const dynamic = "force-dynamic";

type Check = { label: string; state: "ok" | "todo" | "info"; detail: string; href: string };

export default async function SettingsPage() {
  const s = await requireSession();
  const db = await getDb();
  const since = new Date(Date.now() - 26 * 3_600_000);
  const [[practice], [providers], [payers], [noMfa], [runs], [ncci], cfg, sso] = await Promise.all([
    db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.providers).where(and(eq(schema.providers.practiceId, s.practiceId), eq(schema.providers.active, true))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(and(eq(schema.users.practiceId, s.practiceId), isNull(schema.users.mfaSecret), isNull(schema.users.disabledAt))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.automationRuns).where(and(eq(schema.automationRuns.practiceId, s.practiceId), gte(schema.automationRuns.ranAt, since))),
    db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (SELECT 1 FROM ncci_ptp LIMIT 1) x`).then((r) => r.rows),
    practiceConfig(db, s.practiceId),
    getSso(db, s.practiceId),
  ]);
  const p = practice.policies ?? {};
  const policiesOn = [p.writeOffLimitCents != null, p.strictScrub, p.riskHoldScore != null, p.smallBalanceCents != null, p.exportsAdminOnly, p.refundDualControl].filter(Boolean).length;

  const checks: Check[] = [
    { label: "Practice profile", state: isValidNpi(practice.npi) && /^\d{2}-?\d{7}$/.test(practice.taxId) && practice.phone ? "ok" : "todo", detail: isValidNpi(practice.npi) ? (practice.phone ? `NPI ${practice.npi}` : "Add a phone number") : "The NPI fails its check digit", href: "/settings/profile" },
    { label: "Providers and payers", state: Number(providers.n) && Number(payers.n) ? "ok" : "todo", detail: `${providers.n} active providers, ${payers.n} payers`, href: "/settings/providers" },
    { label: "Clearinghouse", state: cfg.stedi ? "ok" : "todo", detail: cfg.stedi ? "Stedi connected: claims go to payers" : "Simulated: connect Stedi to send real claims", href: "/settings/connections" },
    { label: "Two-factor sign-in", state: practice.requireMfa ? "ok" : "todo", detail: practice.requireMfa ? "Required for everyone" : `Optional; ${noMfa.n} ${Number(noMfa.n) === 1 ? "person is" : "people are"} without it`, href: "/settings/security" },
    { label: "Daily automation", state: Number(runs.n) ? "ok" : "todo", detail: Number(runs.n) ? "Ran in the last day" : "Has not run in the last day (check CRON_SECRET on the server)", href: "/settings/automation" },
    { label: "Billing policies", state: policiesOn ? "ok" : "info", detail: policiesOn ? `${policiesOn} rule${policiesOn === 1 ? "" : "s"} on` : "None on: limits and approvals are open", href: "/settings/policies" },
    { label: "National code sets", state: Number(ncci?.n) ? "ok" : "info", detail: Number(ncci?.n) ? "NCCI edits loaded" : "Not loaded: NCCI checks are skipped", href: "/settings/code-sets" },
    { label: "Single sign-on", state: sso ? "ok" : "info", detail: sso ? `On for ${sso.domains.join(", ")}` : "Optional: sign in with Okta, Entra ID or Google", href: "/settings/sso" },
  ];
  const done = checks.filter((c) => c.state === "ok").length;
  const TONE = { ok: "green", todo: "amber", info: "slate" } as const;
  const WORD = { ok: "Done", todo: "To do", info: "Optional" } as const;

  return (
    <>
      <PageHeader title="Settings" subtitle={`${practice.name} · everything that controls how the practice bills, who can do what, and what it connects to`} />
      <Card title={`Setup health · ${done} of ${checks.length}`} className="mb-8">
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${Math.round((done / checks.length) * 100)}%` }} /></div>
        <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {checks.map((c) => (
            <li key={c.label}>
              <Link href={c.href} className="flex items-start justify-between gap-3 rounded-lg p-1 hover:bg-slate-50">
                <span><span className="font-medium text-slate-900">{c.label}</span><span className="block text-xs text-slate-500">{c.detail}</span></span>
                <Badge tone={TONE[c.state]}>{WORD[c.state]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
      <SettingsDirectory sections={settingsFor(s.role)} />
    </>
  );
}
