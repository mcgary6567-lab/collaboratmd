import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { scheduleRates, standardCharges } from "@/server/fees";
import { saveScheduleAction } from "@/app/(app)/fees-actions";
import { Card, PageHeader } from "@/components/ui";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function FeeScheduleEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const [schedule] = await db
    .select()
    .from(schema.feeSchedules)
    .where(and(eq(schema.feeSchedules.id, id), eq(schema.feeSchedules.practiceId, s.practiceId)))
    .limit(1);
  if (!schedule) notFound();

  const [codes, rates, standard] = await Promise.all([
    db.select().from(schema.cptCodes).orderBy(asc(schema.cptCodes.code)),
    scheduleRates(db, schedule.id),
    standardCharges(db, s.practiceId),
  ]);
  const isContract = schedule.payerId !== null;
  const admin = s.role === "admin";

  return (
    <>
      <PageHeader
        title={schedule.name}
        subtitle={
          isContract
            ? "Contracted allowed amounts. Paid claims allowed below these are flagged as underpayments."
            : "Standard charges. Charge entry prices new claims from these."
        }
        actions={<Link href="/settings/fees" className="btn btn-secondary">All schedules</Link>}
      />
      <Card>
        <form action={saveScheduleAction.bind(null, schedule.id)}>
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                {isContract && <th className="text-right">Standard charge</th>}
                <th className="text-right">{isContract ? "Contracted allowed" : "Charge"}</th>
                {isContract && <th className="text-right">% of charge</th>}
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const amt = rates.get(c.code);
                const std = standard.get(c.code) ?? c.defaultFeeCents;
                return (
                  <tr key={c.code}>
                    <td className="font-mono">{c.code}</td>
                    <td>{c.description}</td>
                    {isContract && <td className="text-right tabular-nums text-slate-500">{money(std)}</td>}
                    <td className="text-right">
                      <input
                        name={`amt_${c.code}`}
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={amt !== undefined ? (amt / 100).toFixed(2) : ""}
                        placeholder={isContract ? "No contract rate" : (c.defaultFeeCents / 100).toFixed(2)}
                        className="input ml-auto w-36 text-right"
                        disabled={!admin}
                      />
                    </td>
                    {isContract && (
                      <td className="text-right tabular-nums text-slate-500">
                        {amt !== undefined && std > 0 ? `${Math.round((amt / std) * 100)}%` : "-"}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {admin && (
            <div className="mt-4 flex items-center justify-between gap-4">
              <p className="text-xs text-slate-500">
                Leave a code blank to remove it.{" "}
                {isContract
                  ? "A claim with any uncontracted code is not judged for underpayment."
                  : "Blank codes fall back to the default fee."}
              </p>
              <button className="btn btn-primary">Save schedule</button>
            </div>
          )}
        </form>
      </Card>
    </>
  );
}
