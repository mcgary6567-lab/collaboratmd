import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { settingsFor } from "@/lib/settings-sections";
import { setupHealth } from "@/server/setup-health";
import { Badge, Card, PageHeader } from "@/components/ui";
import { SettingsDirectory } from "./settings-directory";

export const dynamic = "force-dynamic";

const TONE = { ok: "green", todo: "amber", info: "slate" } as const;
const WORD = { ok: "Done", todo: "To do", info: "Optional" } as const;

export default async function SettingsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [checks, [practice]] = await Promise.all([setupHealth(db, s.practiceId), db.select({ name: schema.practices.name }).from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1)]);
  const done = checks.filter((c) => c.state === "ok").length;

  return (
    <>
      <PageHeader title="Settings" subtitle={`${practice.name} · everything that controls how the practice bills, who can do what, and what it connects to`} />
      <Card title={`Setup health · ${done} of ${checks.length}`} className="mb-8">
        <div className="mb-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-green-500" style={{ width: `${Math.round((done / checks.length) * 100)}%` }} /></div>
        <ul className="grid gap-x-8 gap-y-3 md:grid-cols-2">
          {checks.map((c) => (
            <li key={c.key}>
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
