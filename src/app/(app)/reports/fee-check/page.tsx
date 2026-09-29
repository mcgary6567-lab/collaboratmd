import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { feeCheck } from "@/server/fee-check";
import { backfillLinesAction } from "@/app/(app)/fee-check-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";

export const metadata: Metadata = { title: "Fee schedule check" };
export const dynamic = "force-dynamic";

/** Standard charges below what a payer would allow, which caps every claim for the code. */
export default async function FeeCheckPage() {
  const s = await requireSession();
  const r = await feeCheck(await getDb(), s.practiceId);
  return (
    <>
      <PageHeader title="Fee schedule check" subtitle={`Codes billed ${fmtDate(r.from)} to ${fmtDate(r.to)} whose standard charge is below what a payer allows`} actions={<Link href="/settings/fees" className="btn btn-secondary">Fee schedules</Link>} />
      <Card>
        {r.gaps.length === 0 ? <Empty>No charge is below a payer&apos;s allowed amount, contract or Medicare&apos;s rate among the {r.codes} codes billed in the last year.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Charges below allowed amounts" className="overflow-x-auto">
            <table className="table table-stack">
              <thead><tr><th>Code</th><th className="text-right">Lines</th><th className="text-right">Your charge</th><th className="text-right">Highest allowed</th><th>From</th><th className="text-right">Suggested charge</th></tr></thead>
              <tbody>{r.gaps.map((g) => (
                <tr key={g.cpt}>
                  <td data-label="Code" className="font-mono">{g.cpt}</td>
                  <td data-label="Lines" className="text-right tabular-nums">{g.lines}</td>
                  <td data-label="Your charge" className="text-right tabular-nums">{money(g.chargeCents)}</td>
                  <td data-label="Highest allowed" className="text-right font-semibold tabular-nums">{money(g.highestCents)}</td>
                  <td data-label="From" className="text-xs">{g.source}</td>
                  <td data-label="Suggested charge" className="text-right tabular-nums">{money(g.suggestedCents)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">A payer pays the lower of its allowed amount and your charge, so a charge below the allowed amount is money left on every claim. Allowed amounts come from payers&apos; 835 lines, your payer contracts, and Medicare&apos;s fee schedule when your locality is set. Change charges under Fee schedules; one standard charge applies to every payer.</p>
        <ActionForm action={backfillLinesAction} className="mt-3">
          <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Reading remittances...">Read allowed amounts from past remittances</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
