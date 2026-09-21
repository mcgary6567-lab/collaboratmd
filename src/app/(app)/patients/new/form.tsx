"use client";

import { useActionState } from "react";
import { createPatientAction } from "@/app/(app)/actions";
import { Field, Alert } from "@/components/ui";

export function NewPatientForm({ payers }: { payers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createPatientAction, undefined);
  return (
    <form action={action} className="card max-w-3xl space-y-6 p-6">
      {state && !state.ok && <Alert kind="error">{state.message}</Alert>}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Demographics</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name"><input name="firstName" className="input" required /></Field>
          <Field label="Last name"><input name="lastName" className="input" required /></Field>
          <Field label="Date of birth"><input name="dob" type="date" className="input" required /></Field>
          <Field label="Sex">
            <select name="sex" className="select" defaultValue="F">
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="U">Unknown</option>
            </select>
          </Field>
          <Field label="Phone"><input name="phone" className="input" /></Field>
          <Field label="Email"><input name="email" type="email" className="input" /></Field>
          <Field label="Address" className="sm:col-span-2"><input name="address1" className="input" /></Field>
          <Field label="City"><input name="city" className="input" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State"><input name="state" className="input" maxLength={2} /></Field>
            <Field label="ZIP"><input name="zip" className="input" /></Field>
          </div>
        </div>
      </div>
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Primary insurance</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payer">
            <select name="payerId" className="select" required>
              {payers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Member ID"><input name="memberId" className="input" required /></Field>
          <Field label="Group number"><input name="groupNumber" className="input" /></Field>
          <Field label="Relationship to subscriber">
            <select name="relationship" className="select" defaultValue="self">
              <option value="self">Self</option>
              <option value="spouse">Spouse</option>
              <option value="child">Child</option>
              <option value="other">Other</option>
            </select>
          </Field>
          <Field label="Copay ($)"><input name="copay" type="number" step="0.01" min="0" defaultValue="25" className="input" /></Field>
        </div>
      </div>
      <button className="btn btn-primary" disabled={pending}>{pending ? "Saving..." : "Register patient"}</button>
    </form>
  );
}
