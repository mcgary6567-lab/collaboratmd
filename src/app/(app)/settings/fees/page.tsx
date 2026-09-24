import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { listSchedules } from "@/server/fees";
import { createContractAction } from "@/app/(app)/fees-actions";
import { Badge, Card, Empty, Field, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function FeeSchedulesPage() {
  const s = await requireSession();
  const db = await getDb();
  const [schedules, payers] = await Promise.all([
    listSchedules(db, s.practiceId),
    db.select().from(schema.payers).where(eq(schema.payers.practiceId, s.practiceId)).orderBy(asc(schema.payers.name)),
  ]);
  const contracted = new Set(schedules.map((r) => r.schedule.payerId).filter(Boolean));
  const uncontracted = payers.filter((p) => !contracted.has(p.id));
  const hasStandard = schedules.some((r) => r.schedule.payerId === null);
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader
        title="Fee schedules"
        subtitle="What the practice charges, and what each payer contract says it should be paid"
        actions={<Link href="/settings" className="btn btn-secondary">Back to settings</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Schedules on file" className="lg:col-span-2">
          {schedules.length === 0 ? (
            <Empty>No schedules yet. Charges use each code&apos;s default fee until a standard schedule exists.</Empty>
          ) : (
            <table className="table">
              <thead>
                <tr><th>Schedule</th><th>Kind</th><th className="text-right">Codes</th><th>Effective</th><th /></tr>
              </thead>
              <tbody>
                {schedules.map(({ schedule, payerName, items }) => (
                  <tr key={schedule.id}>
                    <td className="font-medium">{schedule.name}</td>
                    <td>
                      {payerName ? <Badge tone="blue">Contract · {payerName}</Badge> : <Badge tone="green">Standard charges</Badge>}
                    </td>
                    <td className="text-right tabular-nums">{items}</td>
                    <td>{fmtDate(schedule.effectiveFrom + "T00:00:00")}</td>
                    <td className="text-right">
                      <Link href={`/settings/fees/${schedule.id}`} className="text-sm font-semibold text-brand-700 hover:underline">
                        {admin ? "Edit" : "View"}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Add a schedule">
          {!admin ? (
            <p className="text-sm text-slate-600">Only an administrator can create or change fee schedules.</p>
          ) : (
            <div className="space-y-6">
              {!hasStandard && (
                <form action={createContractAction} className="space-y-3">
                  <input type="hidden" name="payerId" value="" />
                  <p className="text-sm text-slate-600">
                    Start with a standard schedule. It sets what the practice bills, and payer contracts are built from it.
                  </p>
                  <button className="btn btn-primary w-full justify-center">Create standard schedule</button>
                </form>
              )}
              <form action={createContractAction} className="space-y-3">
                <p className="text-sm text-slate-600">
                  Most contracts are written as a percentage of standard charges. Start there, then adjust individual codes.
                </p>
                <Field label="Payer">
                  <select name="payerId" className="select" required disabled={uncontracted.length === 0}>
                    {uncontracted.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Allowed as % of standard charges">
                  <input name="percent" type="number" min="1" max="200" step="0.5" defaultValue="60" className="input" required />
                </Field>
                <button className="btn btn-primary w-full justify-center" disabled={uncontracted.length === 0}>
                  {uncontracted.length === 0 ? "Every payer has a contract" : "Create contract"}
                </button>
              </form>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
