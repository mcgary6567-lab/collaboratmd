import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { CAN_ADJUST, requireSession } from "@/lib/auth";
import { disputeData, disputeLetterText, LETTER_MAX } from "@/server/recovery";
import { markDisputedAction } from "@/app/(app)/recovery-actions";
import { ActionForm, PrintButton, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Card, Empty, PageHeader } from "@/components/ui";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function DisputeLetterPage({ params }: { params: Promise<{ payerId: string }> }) {
  const { payerId } = await params;
  const s = await requireSession();
  const d = await disputeData(await getDb(), s.practiceId, payerId).catch(() => null);
  if (!d) notFound();
  const letter = disputeLetterText(d);
  const openIds = d.claims.map((c) => c.underpaymentId);
  const canAdjust = (CAN_ADJUST as readonly string[]).includes(s.role);

  return (
    <>
      <PageHeader
        title={`Dispute letter: ${d.payer.name}`}
        subtitle={`${d.claims.length} claim${d.claims.length === 1 ? "" : "s"} below contract, ${money(d.totalCents)} short in total${d.claims.length === LETTER_MAX ? ` (the ${LETTER_MAX} largest; more follow in the next letter)` : ""}`}
        actions={<><PrintButton label="Print letter" /><Link href="/underpayments" className="btn btn-secondary no-print">Back</Link></>}
      />
      {d.claims.length === 0 ? (
        <Card><Empty>No open underpayments for this payer. Sent letters are tracked on the Appealed tab.</Empty></Card>
      ) : (
        <>
          <Card className="mb-6 no-print">
            <p className="text-sm text-slate-600">
              Check the contracted rates and fill in the signature line before sending. Mail or fax it to the payer&apos;s provider dispute address, or paste it into their reconsideration portal.
              When it is sent, mark the claims as appealed so they move to the Appealed tab and the recovery can be tracked.
            </p>
            <div className="mt-3 flex flex-wrap items-start gap-3">
              <CopyButton value={letter} label="Copy letter" />
              {canAdjust && (
                <ActionForm action={markDisputedAction.bind(null, openIds)}>
                  <SubmitButton pendingLabel="Saving...">Mark as sent</SubmitButton>
                </ActionForm>
              )}
            </div>
          </Card>
          <Card>
            <pre className="whitespace-pre-wrap font-serif text-sm leading-relaxed text-slate-900">{letter}</pre>
          </Card>
        </>
      )}
    </>
  );
}
