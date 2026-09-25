import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { Card, PageHeader, Badge } from "@/components/ui";
import { money } from "@/lib/utils";
import { clearinghouseName } from "@/lib/clearinghouse/gateway";
import { practiceConfig } from "@/server/integrations";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [[practice], providers, payers, users, cpts] = await Promise.all([
    db.select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1),
    db.select().from(schema.providers).where(eq(schema.providers.practiceId, s.practiceId)).orderBy(asc(schema.providers.lastName)),
    db.select().from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId)).orderBy(asc(schema.payers.name)),
    db.select().from(schema.users).where(eq(schema.users.practiceId, s.practiceId)).orderBy(asc(schema.users.name)),
    db.select().from(schema.cptCodes).orderBy(asc(schema.cptCodes.code)),
  ]);
  const cfg = await practiceConfig(db, s.practiceId);
  return (
    <>
      <PageHeader title="Settings" subtitle="Practice configuration, providers, payers, users and fee schedule" actions={<Link href="/settings/connections" className="btn btn-primary">Integrations and API keys</Link>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Practice (billing provider)">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Name</dt><dd className="font-medium">{practice.name}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Tax ID</dt><dd className="font-mono">{practice.taxId}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">NPI (Type 2)</dt><dd className="font-mono">{practice.npi}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Address</dt><dd className="text-right">{practice.address1}<br />{practice.city}, {practice.state} {practice.zip}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Clearinghouse</dt><dd>{clearinghouseName(cfg.stedi?.apiKey) === "Stedi" ? <Badge tone="green">Stedi (live)</Badge> : <Link href="/settings/connections"><Badge tone="amber">Simulated · connect Stedi</Badge></Link>}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">AI rejection support</dt><dd><Badge tone={cfg.anthropic ? "green" : "slate"}>{cfg.anthropic ? "Claude enabled" : "Rules-based · connect Claude"}</Badge></dd></div>
          </dl>
        </Card>
        <Card title="Users" actions={<span className="flex gap-2"><Link href="/settings/team" className="btn btn-secondary text-xs">Team and roles</Link><Link href="/settings/sso" className="btn btn-secondary text-xs">Single sign-on</Link><Link href="/settings/security" className="btn btn-secondary text-xs">Sign-in security</Link></span>}>
          <table className="table">
            <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td className="capitalize">{u.role.replace("_", " ")}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Providers">
          <table className="table">
            <thead><tr><th>Provider</th><th>NPI</th><th>Taxonomy</th><th>Specialty</th></tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id}><td>Dr. {p.firstName} {p.lastName}</td><td className="font-mono">{p.npi}</td><td className="font-mono">{p.taxonomy}</td><td>{p.specialty}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Payers" actions={<span className="flex gap-2"><Link href="/settings/enrollment" className="btn btn-secondary text-xs">Enrollment</Link><Link href="/settings/payer-edits" className="btn btn-secondary text-xs">Payer edits</Link><Link href="/settings/integrations" className="btn btn-secondary text-xs">EHR integrations</Link><Link href="/settings/automation" className="btn btn-secondary text-xs">Automation</Link></span>}>
          <table className="table">
            <thead><tr><th>Payer</th><th>Payer ID</th><th>Type</th><th className="text-right">Timely filing</th><th className="text-right">Appeal</th></tr></thead>
            <tbody>
              {payers.map((p) => (
                <tr key={p.id}><td>{p.name}</td><td className="font-mono">{p.payerId}</td><td className="capitalize">{p.type}</td><td className="text-right">{p.timelyFilingDays}d</td><td className="text-right">{p.appealDays}d</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Default fees (CPT / HCPCS)" className="lg:col-span-2" actions={<Link href="/settings/fees" className="btn btn-secondary text-xs">Fee schedules and payer contracts</Link>}>
          <table className="table">
            <thead><tr><th>Code</th><th>Description</th><th className="text-right">Fee</th></tr></thead>
            <tbody>
              {cpts.map((c) => (
                <tr key={c.code}><td className="font-mono">{c.code}</td><td>{c.description}</td><td className="text-right">{money(c.defaultFeeCents)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </>
  );
}
