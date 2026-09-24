import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listUnderpayments, underpaymentSummary } from "@/server/fees";
import { scanUnderpaymentsAction, underpaymentStatusAction } from "@/app/(app)/fees-actions";
import { Card, Empty, Money, PageHeader, PatientLink, Stat } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const dynamic = "force-dynamic";

const TABS = [
  { status: "open", label: "Open" },
  { status: "appealed", label: "Appealed" },
  { status: "recovered", label: "Recovered" },
  { status: "accepted", label: "Accepted" },
];

export default async function UnderpaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: requested } = await searchParams;
  const status = TABS.some((t) => t.status === requested) ? requested! : "open";
  const s = await requireSession();
  const db = await getDb();
  const [rows, summary] = await Promise.all([listUnderpayments(db, s.practiceId, status), underpaymentSummary(db, s.practiceId)]);
  const open = summary.open ?? { count: 0, varianceCents: 0 };
  const appealed = summary.appealed ?? { count: 0, varianceCents: 0 };
  const recovered = summary.recovered ?? { count: 0, varianceCents: 0 };

  return (
    <>
      <PageHeader
        title="Underpayments"
        subtitle="Paid claims whose allowed amount fell short of the payer contract"
        actions={
          <form action={scanUnderpaymentsAction}>
            <button className="btn btn-primary">Scan paid claims</button>
          </form>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Open" value={money(open.varianceCents)} hint={`${open.count.toLocaleString("en-US")} claims below contract`} />
        <Stat label="Appealed" value={money(appealed.varianceCents)} hint={`${appealed.count.toLocaleString("en-US")} reconsiderations sent`} />
        <Stat label="Recovered" value={money(recovered.varianceCents)} hint={`${recovered.count.toLocaleString("en-US")} paid correctly on review`} tone="good" />
      </div>

      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.status}
            href={`/underpayments?status=${t.status}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${t.status === status ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50"}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <Card>
        {rows.length === 0 ? (
          <Empty>
            {status === "open"
              ? "Nothing open. Claims are checked as each ERA posts; scan to check historical claims against current contracts."
              : "No underpayments in this state."}
          </Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Claim</th><th>Patient</th><th>Payer</th><th>Detected</th>
                <th className="text-right">Contract</th><th className="text-right">Allowed</th><th className="text-right">Short</th>
                {status === "open" || status === "appealed" ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ underpayment: u, claim, payer, patient }) => (
                <tr key={u.id}>
                  <td><Link href={`/claims/${claim.id}`} className="font-mono text-brand-700 hover:underline">{claim.controlNumber}</Link></td>
                  <td><PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} /></td>
                  <td>{payer.name}</td>
                  <td>{fmtDate(u.detectedAt)}</td>
                  <td className="text-right"><Money cents={u.expectedAllowedCents} /></td>
                  <td className="text-right"><Money cents={u.actualAllowedCents} /></td>
                  <td className="text-right font-semibold text-amber-700"><Money cents={u.varianceCents} /></td>
                  {status === "open" && (
                    <td className="whitespace-nowrap text-right">
                      <form action={underpaymentStatusAction.bind(null, u.id, "appealed")} className="inline">
                        <button className="btn btn-secondary text-xs">Appeal</button>
                      </form>{" "}
                      <form action={underpaymentStatusAction.bind(null, u.id, "accepted")} className="inline">
                        <button className="btn btn-secondary text-xs">Accept</button>
                      </form>
                    </td>
                  )}
                  {status === "appealed" && (
                    <td className="whitespace-nowrap text-right">
                      <form action={underpaymentStatusAction.bind(null, u.id, "recovered")} className="inline">
                        <button className="btn btn-primary text-xs">Recovered</button>
                      </form>{" "}
                      <form action={underpaymentStatusAction.bind(null, u.id, "accepted")} className="inline">
                        <button className="btn btn-secondary text-xs">Upheld</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
