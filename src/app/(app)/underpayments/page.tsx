import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listUnderpayments, underpaymentSummary } from "@/server/fees";
import { scanUnderpaymentsAction, underpaymentStatusAction } from "@/app/(app)/fees-actions";
import { recordRecoveryAction } from "@/app/(app)/recovery-actions";
import { disputeGroups, LETTER_MAX } from "@/server/recovery";
import { ActionForm, SubmitButton } from "@/components/action-form";
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
  const [rows, summary, letters] = await Promise.all([
    listUnderpayments(db, s.practiceId, status),
    underpaymentSummary(db, s.practiceId),
    status === "open" ? disputeGroups(db, s.practiceId) : Promise.resolve([]),
  ]);
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

      {letters.length > 0 && (
        <Card title="Dispute letters" className="mb-6">
          <p className="mb-3 text-sm text-slate-600">One reconsideration letter per payer, listing every claim paid below your contract with the rate you expected. Each letter takes the {LETTER_MAX} largest open claims; mark it sent and the next letter picks up the rest.</p>
          <div className="flex flex-wrap gap-2">
            {letters.map((g) => (
              <Link key={g.payerId} href={`/underpayments/letter/${g.payerId}`} className="rounded-lg border border-slate-200 px-3 py-2 text-sm hover:border-brand-300 hover:bg-brand-50">
                <span className="font-semibold text-slate-900">{g.name}</span>
                <span className="ml-2 text-slate-500">{g.count.toLocaleString("en-US")} claim{g.count === 1 ? "" : "s"} · {money(g.cents)}</span>
              </Link>
            ))}
          </div>
        </Card>
      )}

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
                {status === "recovered" ? <th className="text-right">Recovered</th> : null}
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
                  {status === "recovered" && <td className="text-right font-semibold text-green-700">{u.recoveredCents === null ? "n/a" : <Money cents={u.recoveredCents} />}</td>}
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
                      {u.disputedAt && <span className="mr-2 text-xs text-slate-500">sent {fmtDate(u.disputedAt)}</span>}
                      <ActionForm action={recordRecoveryAction.bind(null, u.id)} className="inline-flex items-center gap-1">
                        <input name="amount" defaultValue={(u.varianceCents / 100).toFixed(2)} className="input w-24 py-1 text-right text-xs" aria-label="Amount recovered" />
                        <SubmitButton className="btn btn-primary text-xs" pendingLabel="...">Recovered</SubmitButton>
                      </ActionForm>{" "}
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
