"use client";

import { useActionState, useState } from "react";
import { createPatientAction } from "@/app/(app)/actions";
import { Field, Alert } from "@/components/ui";
import { PhoneInput, StateSelect, ZipInput } from "@/components/us-fields";
import { SubscriberFields } from "@/components/subscriber-fields";
import { REFERRAL_SOURCES } from "@/lib/referral-sources";

export function NewPatientForm({ payers }: { payers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createPatientAction, undefined);
  const [insured, setInsured] = useState(true);
  return (
    <form action={action} className="card max-w-3xl space-y-6 p-6">
      {state && !state.ok && <Alert kind="error">{state.message}</Alert>}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Demographics</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name"><input name="firstName" className="input" autoComplete="off" required /></Field>
          <Field label="Last name"><input name="lastName" className="input" autoComplete="off" required /></Field>
          <Field label="Date of birth"><input name="dob" type="date" className="input" required /></Field>
          <Field label="Sex">
            <select name="sex" className="select" defaultValue="" required>
              <option value="" disabled>Choose...</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="U">Unknown</option>
            </select>
          </Field>
          <Field label="Mobile phone"><PhoneInput /></Field>
          <Field label="Email"><input name="email" type="email" className="input" autoComplete="off" /></Field>
          <Field label="Street address" className="sm:col-span-2"><input name="address1" className="input" autoComplete="off" /></Field>
          <Field label="City"><input name="city" className="input" autoComplete="off" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State"><StateSelect /></Field>
            <Field label="ZIP"><ZipInput /></Field>
          </div>
          <Field label="How did they hear about us?">
            <select name="referralSource" className="input" defaultValue="">
              <option value="">Not asked</option>
              {Object.entries(REFERRAL_SOURCES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Referring doctor or detail"><input name="referralDetail" className="input" autoComplete="off" maxLength={120} /></Field>
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Primary insurance</h2>
        <fieldset className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <legend className="sr-only">Does the patient have insurance?</legend>
          <label className="flex items-center gap-2"><input type="radio" name="coverage" value="insured" checked={insured} onChange={() => setInsured(true)} /> Insured</label>
          <label className="flex items-center gap-2"><input type="radio" name="coverage" value="self_pay" checked={!insured} onChange={() => setInsured(false)} /> Self-pay (no insurance)</label>
        </fieldset>
        {insured ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payer">
              <select name="payerId" className="select" required defaultValue="">
                <option value="" disabled>Choose the payer...</option>
                {payers.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Member ID"><input name="memberId" className="input" autoComplete="off" required /></Field>
            <Field label="Group number"><input name="groupNumber" className="input" autoComplete="off" /></Field>
            <Field label="Copay ($)"><input name="copay" type="number" step="0.01" min="0" inputMode="decimal" placeholder="0.00" className="input" /></Field>
            <SubscriberFields className="sm:col-span-2" />
          </div>
        ) : (
          <p className="text-sm text-slate-600">Visits are billed to the patient. Add insurance on their page later if they get coverage; coverage discovery can look for it.</p>
        )}
      </div>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Saving..." : "Register patient"}</button>
    </form>
  );
}
