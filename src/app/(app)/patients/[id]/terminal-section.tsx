import type { Db } from "@/db";
import { practiceConfig } from "@/server/integrations";
import { listReaders, recentTerminalPayments } from "@/server/terminal";
import { cancelTerminalPaymentAction, checkTerminalPaymentAction, createSimulatedReaderAction, simulateTapAction, startTerminalPaymentAction } from "@/app/(app)/terminal-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card } from "@/components/ui";
import { fmtDateTime, money } from "@/lib/utils";

const TONE = { waiting: "amber", succeeded: "green", failed: "red", canceled: "slate" } as const;

/** Card-present payment on a Stripe Terminal reader. Shown only when Stripe is connected. */
export async function TerminalSection({ db, practiceId, patientId, canWrite, admin, timeZone }: { db: Db; practiceId: string; patientId: string; canWrite: boolean; admin: boolean; timeZone?: string }) {
  if (!(await practiceConfig(db, practiceId)).stripe) return null;
  let readers: Awaited<ReturnType<typeof listReaders>>["readers"] = [];
  let test = false;
  let error: string | null = null;
  try {
    ({ readers, test } = await listReaders(db, practiceId));
  } catch (e) {
    error = e instanceof Error ? e.message : "Could not list readers";
  }
  const payments = await recentTerminalPayments(db, practiceId, patientId);
  if (!readers.length && !payments.length && !admin) return null;

  return (
    <Card title="Card reader at the front desk" className="mb-6" actions={test ? <Badge tone="amber">Stripe test mode</Badge> : undefined}>
      {error && <p className="mb-3 text-sm text-red-700">{error}</p>}
      {readers.length === 0 ? (
        <div className="space-y-2 text-sm text-slate-600">
          <p>No card readers are registered in this Stripe account. Register a WisePOS E or S700 in the Stripe dashboard under Terminal, and it appears here.</p>
          {admin && test && <ActionForm action={createSimulatedReaderAction.bind(null, patientId)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="Creating...">Create a simulated reader to try it</SubmitButton></ActionForm>}
        </div>
      ) : canWrite && (
        <ActionForm action={startTerminalPaymentAction.bind(null, patientId)} className="flex flex-wrap items-end gap-3 text-sm">
          <label className="block"><span className="label">Reader</span>
            <select name="readerId" className="input" aria-label="Reader">{readers.map((r) => <option key={r.id} value={r.id}>{r.label ?? r.id}{r.status === "offline" ? " (offline)" : ""}</option>)}</select>
          </label>
          <label className="block"><span className="label">Amount ($)</span><input name="amount" type="number" min="0.50" step="0.01" className="input w-32" required /></label>
          <SubmitButton pendingLabel="Sending...">Send to reader</SubmitButton>
        </ActionForm>
      )}
      {payments.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {payments.slice(0, 5).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-semibold tabular-nums">{money(p.amountCents)}</span>{" "}
                <Badge tone={TONE[p.status as keyof typeof TONE] ?? "slate"}>{p.status}</Badge>{" "}
                <span className="text-xs text-slate-500">{fmtDateTime(p.createdAt, timeZone)}{p.failure ? ` · ${p.failure}` : ""}</span>
              </span>
              {p.status === "waiting" && canWrite && (
                <span className="flex gap-2">
                  <ActionForm action={checkTerminalPaymentAction.bind(null, patientId, p.id)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Check</SubmitButton></ActionForm>
                  {test && <ActionForm action={simulateTapAction.bind(null, patientId, p.id)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Tap test card</SubmitButton></ActionForm>}
                  <ActionForm action={cancelTerminalPaymentAction.bind(null, patientId, p.id)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">Cancel</SubmitButton></ActionForm>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-500">A payment posts once Stripe confirms it. Press Check, or add the payment_intent.succeeded event to your Stripe webhook so it posts on its own.</p>
    </Card>
  );
}
