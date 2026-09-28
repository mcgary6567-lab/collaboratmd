"use client";

import Link from "next/link";
import { Printer } from "lucide-react";
import { markMailedAction } from "@/app/(app)/paper-claim-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";

export function PrintToolbar({ claimId, controlNumber, status, plain, test, pages }: { claimId: string; controlNumber: string; status: string; plain: boolean; test: boolean; pages: number }) {
  const base = `/print/cms1500/${claimId}`;
  return (
    <div className="no-print sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 text-sm">
      <Link href={`/claims/${claimId}`} className="btn btn-secondary">Back to claim {controlNumber}</Link>
      <span className="text-slate-600">{test ? "Alignment test" : `${pages} form${pages === 1 ? "" : "s"}`}</span>
      <nav className="flex gap-1" aria-label="What to print">
        <Link href={base} className={`rounded-full px-3 py-1 text-xs font-semibold ${!plain && !test ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700"}`}>On a red form</Link>
        <Link href={`${base}?plain=1`} className={`rounded-full px-3 py-1 text-xs font-semibold ${plain && !test ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700"}`}>On plain paper</Link>
        <Link href={`${base}?test=1`} className={`rounded-full px-3 py-1 text-xs font-semibold ${test ? "bg-brand-700 text-white" : "bg-slate-100 text-slate-700"}`}>Alignment test</Link>
      </nav>
      <button type="button" className="btn btn-primary" onClick={() => window.print()}><Printer className="h-4 w-4" /> Print</button>
      {!test && (status === "ready" || status === "rejected") && (
        <ActionForm action={markMailedAction.bind(null, claimId)} className="ml-auto">
          <SubmitButton className="btn btn-secondary" pendingLabel="Saving...">Mark as mailed</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
