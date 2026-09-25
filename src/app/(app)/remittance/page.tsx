import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { Card, PageHeader, Money, Empty, Badge } from "@/components/ui";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { RemittanceTools } from "./tools";

export const dynamic = "force-dynamic";

export default async function RemittancePage() {
  const s = await requireSession();
  const db = await getDb();
  const rows = await db.select().from(schema.remittances).where(eq(schema.remittances.practiceId, s.practiceId)).orderBy(desc(schema.remittances.receivedAt)).limit(100);
  return (
    <>
      <PageHeader title="Remittance (ERA / 835)" subtitle="Electronic remittance advice with automated payment posting" actions={<><a href="/remittance/deposits" className="btn btn-secondary">Bank deposits</a><RemittanceTools /></>} />
      <Card>
        {rows.length === 0 ? (
          <Empty>No remittances yet. Fetch ERAs from the clearinghouse for accepted claims.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Received</th><th>Payer</th><th>Check / EFT</th><th>Payment date</th><th className="text-right">Amount</th><th>Posting</th><th>Summary</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const sum = r.postingSummary as { matched?: number; unmatched?: string[]; paidCents?: number; patientRespCents?: number; adjustedCents?: number; denials?: number } | null;
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(r.receivedAt)}</td>
                    <td>{r.payerName}</td>
                    <td className="font-mono text-xs">{r.checkNumber}</td>
                    <td>{fmtDate(r.paymentDate + "T00:00:00")}</td>
                    <td className="text-right"><Money cents={r.amountCents} /></td>
                    <td><Badge tone={r.posted ? "green" : "amber"}>{r.posted ? "auto-posted" : "pending"}</Badge></td>
                    <td className="text-xs text-slate-600">
                      {sum ? (
                        <>
                          {sum.matched} claims · adj <Money cents={sum.adjustedCents ?? 0} /> · patient <Money cents={sum.patientRespCents ?? 0} /> · {sum.denials ?? 0} denials
                          {sum.unmatched && sum.unmatched.length > 0 && <span className="ml-1 text-red-700">· unmatched {sum.unmatched.join(", ")}</span>}
                        </>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      {rows[0] && (
        <Card title={`Latest 835 (${rows[0].checkNumber})`} className="mt-6">
          <pre className="max-h-80 overflow-auto rounded-lg bg-slate-900 p-4 font-mono text-[11px] leading-relaxed text-sky-200">{rows[0].raw835}</pre>
        </Card>
      )}
    </>
  );
}
