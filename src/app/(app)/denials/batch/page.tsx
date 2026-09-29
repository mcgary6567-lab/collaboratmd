import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { CAN_ADJUST, requireSession } from "@/lib/auth";
import { batchAppealGroups, batchAppealLetter } from "@/server/batch-appeals";
import { sendBatchAppealAction } from "@/app/(app)/batch-appeal-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { Card, Empty, PageHeader } from "@/components/ui";
import { money } from "@/lib/utils";

export const metadata: Metadata = { title: "Batch appeals" };
export const dynamic = "force-dynamic";

/** Open denials grouped by payer and reason, and one appeal letter for a whole group. */
export default async function BatchAppealsPage({ searchParams }: { searchParams: Promise<{ payer?: string; carc?: string }> }) {
  const s = await requireSession();
  const q = await searchParams;
  const db = await getDb();
  const groups = await batchAppealGroups(db, s.practiceId);
  const chosen = groups.find((g) => g.payerId === q.payer && g.carc === q.carc);
  const letter = chosen ? await batchAppealLetter(db, s.practiceId, chosen.payerId, chosen.carc) : null;
  const canAdjust = (CAN_ADJUST as readonly string[]).includes(s.role);
  return (
    <>
      <PageHeader title="Batch appeals" subtitle="Many claims denied by one payer for the same reason, appealed with one letter" actions={<Link href="/denials" className="btn btn-secondary">Denials</Link>} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Groups" className="lg:col-span-1">
          {groups.length === 0 ? <Empty>No payer has two or more open denials for the same reason.</Empty> : (
            <ul className="space-y-2 text-sm">
              {groups.map((g) => (
                <li key={`${g.payerId}-${g.carc}`}>
                  <Link href={`/denials/batch?payer=${g.payerId}&carc=${g.carc}`} aria-current={chosen === g ? "true" : undefined} className={`block rounded-lg border px-3 py-2 hover:border-brand-300 ${chosen === g ? "border-brand-400 bg-brand-50 dark:bg-brand-950" : "border-slate-200 dark:border-slate-700"}`}>
                    <span className="font-semibold">{g.payerName}</span> · CARC {g.carc}
                    <span className="block text-xs text-slate-600 dark:text-slate-400">{g.reason} · {g.count} claims · {money(g.cents)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={letter ? `${letter.payer.name}: CARC ${letter.carc}` : "Letter"} className="lg:col-span-2">
          {!letter ? <Empty>Choose a group to write its appeal.</Empty> : (
            <>
              {letter.held.length > 0 && <p className="mb-3 text-sm text-amber-800">Left out while the payer waits for their medical records: {letter.held.join(", ")}.</p>}
              {canAdjust && (
                <ActionForm action={sendBatchAppealAction.bind(null, letter.payer.id, letter.carc)} className="mb-4 space-y-2 text-sm">
                  <label className="block"><span className="label">Why the denials are wrong (goes in the letter)</span>
                    <textarea name="argument" rows={3} className="input" placeholder="The payer's policy effective June 1 covers these services for this diagnosis; the denials applied the old policy." />
                  </label>
                  <SubmitButton pendingLabel="Saving...">Mark all {letter.claims.length} appealed with this letter</SubmitButton>
                </ActionForm>
              )}
              <CopyButton value={letter.text} label="Copy letter" />
              <pre className="mt-3 whitespace-pre-wrap font-serif text-sm leading-relaxed">{letter.text}</pre>
            </>
          )}
        </Card>
      </div>
    </>
  );
}
