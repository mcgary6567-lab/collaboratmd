import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { findDuplicates } from "@/server/patient-merge";
import { mergePatientsAction } from "@/app/(app)/review-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const metadata: Metadata = { title: "Duplicate patients" };
export const dynamic = "force-dynamic";

/** Likely duplicate records, side by side, merged into the one kept. */
export default async function DuplicatesPage() {
  const s = await requireSession();
  const pairs = await findDuplicates(await getDb(), s.practiceId);
  const canMerge = ["admin", "biller"].includes(s.role);
  return (
    <>
      <PageHeader title="Duplicate patients" subtitle="Records that look like the same person: the same name and date of birth, the same member ID with the same payer, or the same date of birth and phone" actions={<Link href="/patients" className="btn btn-secondary">Patients</Link>} />
      <Card>
        {pairs.length === 0 ? <Empty>No likely duplicates.</Empty> : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {pairs.map(({ a, b, reasons }) => (
              <li key={`${a.id}-${b.id}`} className="py-4">
                <div className="mb-2 flex flex-wrap gap-2">{reasons.map((r) => <Badge key={r} tone="amber">{r}</Badge>)}</div>
                <ActionForm action={mergePatientsAction} className="grid gap-3 text-sm md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <input type="hidden" name="a" value={a.id} />
                  <input type="hidden" name="b" value={b.id} />
                  {[a, b].map((p, i) => (
                    <label key={p.id} className="flex gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                      <input type="radio" name="keep" value={p.id} defaultChecked={i === 0} disabled={!canMerge} aria-label={`Keep ${p.name}, MRN ${p.mrn}`} />
                      <span>
                        <Link href={`/patients/${p.id}`} className="font-semibold text-brand-700 hover:underline">{p.name}</Link>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">MRN {p.mrn} · born {fmtDate(`${p.dob}T00:00:00`)} · {p.visits} visit{p.visits === 1 ? "" : "s"} · added {fmtDate(`${p.createdAt}T00:00:00`)}</span>
                      </span>
                    </label>
                  ))}
                  {canMerge && <SubmitButton pendingLabel="Merging...">Merge into the one chosen</SubmitButton>}
                </ActionForm>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Merging moves every visit, claim, payment, statement, message and document to the record kept; the other record stays, marked as merged, and opening it opens the one kept.
          Check they really are the same person first: a parent and child can share a name, and twins share a date of birth. Every merge is in the audit log.
        </p>
      </Card>
    </>
  );
}
