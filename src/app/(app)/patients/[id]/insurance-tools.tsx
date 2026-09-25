"use client";

import { useActionState } from "react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { addInsuranceAction, readCardAction, type CardState } from "@/app/(app)/front-desk-actions";

/**
 * Adds a policy by hand, or from a photo of the card when card reading is on.
 * The photo fills the form; nothing is saved until the form is.
 */
export function InsuranceTools({ patientId, payers, cardReading }: { patientId: string; payers: { id: string; name: string }[]; cardReading: boolean }) {
  const [card, readCard, reading] = useActionState<CardState, FormData>(readCardAction, undefined);
  const f = card?.ok ? card.fields : undefined;
  // Re-mount the form with the card's values each time a card is read.
  const formKey = f ? JSON.stringify(f) : "blank";

  return (
    <details className="mt-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm" open={!!f}>
      <summary className="cursor-pointer font-semibold text-brand-700">Add insurance</summary>
      {cardReading ? (
        <form action={readCard} className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
          <p className="text-xs text-slate-600">Read it from a photo of the card. The photos go to Claude under your BAA to be read and are not stored.</p>
          <label className="block text-xs">Front <input type="file" name="front" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" className="mt-1 block w-full text-xs" /></label>
          <label className="block text-xs">Back (optional) <input type="file" name="back" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" className="mt-1 block w-full text-xs" /></label>
          <button className="btn btn-secondary text-xs" disabled={reading}>{reading ? "Reading..." : "Read card"}</button>
          {card?.message && <p className={`text-xs font-medium ${card.ok ? "text-green-700" : "text-red-700"}`}>{card.message}</p>}
          {f && (
            <dl className="grid grid-cols-2 gap-x-3 text-xs text-slate-600">
              {f.payerName && <><dt>Printed payer</dt><dd>{f.payerName}</dd></>}
              {f.subscriberName && <><dt>Subscriber</dt><dd>{f.subscriberName}</dd></>}
              {f.planName && <><dt>Plan</dt><dd>{f.planName}</dd></>}
              {f.copays && <><dt>Copays</dt><dd>{f.copays}</dd></>}
              {f.payerPhone && <><dt>Payer phone</dt><dd>{f.payerPhone}</dd></>}
              {(f.rxBin || f.rxPcn) && <><dt>Rx BIN / PCN</dt><dd>{f.rxBin ?? "-"} / {f.rxPcn ?? "-"}</dd></>}
            </dl>
          )}
        </form>
      ) : (
        <p className="mt-2 text-xs text-slate-500">Reading cards from a photo turns on when Claude is connected with a BAA confirmed.</p>
      )}

      <ActionForm key={formKey} action={addInsuranceAction.bind(null, patientId)} className="mt-3 space-y-2">
        <label className="block text-xs">Payer
          <select name="payerId" defaultValue={card?.payerId ?? ""} className="input mt-1" required>
            <option value="" disabled>Choose the payer</option>
            {payers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        {f?.payerName && !card?.payerId && <p className="text-xs text-amber-700">No payer on file matches &ldquo;{f.payerName}&rdquo;. Pick one, or add the payer first.</p>}
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs">Member ID<input name="memberId" defaultValue={f?.memberId ?? ""} className="input mt-1" required /></label>
          <label className="block text-xs">Group<input name="groupNumber" defaultValue={f?.groupNumber ?? ""} className="input mt-1" /></label>
          <label className="block text-xs">Relationship
            <select name="relationship" defaultValue="self" className="input mt-1">
              <option value="self">Self</option><option value="spouse">Spouse</option><option value="child">Child</option><option value="other">Other</option>
            </select>
          </label>
          <label className="block text-xs">Copay<input name="copay" inputMode="decimal" placeholder="0.00" className="input mt-1" /></label>
        </div>
        <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="makePrimary" /> Make this the primary insurance</label>
        <SubmitButton className="btn btn-primary text-xs" pendingLabel="Saving...">Save insurance</SubmitButton>
      </ActionForm>
    </details>
  );
}
