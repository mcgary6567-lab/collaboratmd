import { revokeCardOnFileAction } from "@/app/(app)/card-on-file-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card } from "@/components/ui";
import { fmtDate, money } from "@/lib/utils";
import type { cardOnFileFor } from "@/server/card-on-file";

/** The patient's card on file for balances after insurance: the authorization, recent charges, and a way to stop it. */
export function CardOnFileCard({ patientId, data, canWrite }: { patientId: string; data: NonNullable<Awaited<ReturnType<typeof cardOnFileFor>>>; canWrite: boolean }) {
  const { card, notices } = data;
  return (
    <Card title="Card on file">
      <p className="text-sm">
        {card.brand ?? "Card"} ending {card.last4 ?? "????"}: charged after insurance for up to {money(card.balanceMaxCents)}, with a notice 3 days before.
        {card.balanceAuthorizedAt ? ` Authorized by the patient ${fmtDate(card.balanceAuthorizedAt)} in the portal.` : ""}
      </p>
      {notices.length > 0 && (
        <ul className="mt-2 text-xs text-slate-600 dark:text-slate-400">
          {notices.map((n) => <li key={n.id}>{fmtDate(n.noticeOn)}: {money(n.amountCents)} for {fmtDate(n.chargeOn)} · {n.status}{n.detail ? ` (${n.detail})` : ""}</li>)}
        </ul>
      )}
      {canWrite && (
        <ActionForm action={revokeCardOnFileAction.bind(null, patientId)} className="mt-3">
          <SubmitButton className="btn btn-secondary text-xs" pendingLabel="Stopping...">Stop charging this card</SubmitButton>
        </ActionForm>
      )}
    </Card>
  );
}
