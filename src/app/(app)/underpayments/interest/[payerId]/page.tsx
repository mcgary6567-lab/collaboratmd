import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { CAN_ADJUST, requireSession } from "@/lib/auth";
import { interestLetter } from "@/server/prompt-pay";
import { markInterestRequestedAction } from "@/app/(app)/prompt-pay-actions";
import { ActionForm, PrintButton, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Card, Empty, PageHeader } from "@/components/ui";
import { money } from "@/lib/utils";

export const metadata: Metadata = { title: "Prompt-pay interest letter" };
export const dynamic = "force-dynamic";

export default async function InterestLetterPage({ params }: { params: Promise<{ payerId: string }> }) {
  const { payerId } = await params;
  const s = await requireSession();
  const d = await interestLetter(await getDb(), s.practiceId, payerId).catch(() => null);
  if (!d) notFound();
  const canAdjust = (CAN_ADJUST as readonly string[]).includes(s.role);
  return (
    <>
      <PageHeader
        title={`Late payment interest: ${d.payer.name}`}
        subtitle={`${d.claims.length} claim${d.claims.length === 1 ? "" : "s"} paid late, ${money(d.total)} interest`}
        actions={<><PrintButton label="Print letter" /><Link href="/underpayments" className="btn btn-secondary no-print">Back</Link></>}
      />
      {d.claims.length === 0 ? <Card><Empty>No late payments from this payer that have not been asked about.</Empty></Card> : (
        <>
          <Card className="mb-6 no-print">
            <p className="text-sm text-slate-600 dark:text-slate-400">Check each claim was clean when submitted and that the plan is not self-funded (ERISA plans are exempt from state law), then sign and send it. Mark it sent so the next letter leaves these claims out.</p>
            <div className="mt-3 flex flex-wrap items-start gap-3">
              <CopyButton value={d.text} label="Copy letter" />
              {canAdjust && <ActionForm action={markInterestRequestedAction.bind(null, payerId)}><SubmitButton pendingLabel="Saving...">Mark as sent</SubmitButton></ActionForm>}
            </div>
          </Card>
          <Card><pre className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-slate-900 dark:text-slate-100">{d.text}</pre></Card>
        </>
      )}
    </>
  );
}
