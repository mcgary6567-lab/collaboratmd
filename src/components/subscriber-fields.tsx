"use client";

import { useState } from "react";
import { Field } from "@/components/ui";
import { StateSelect, ZipInput } from "@/components/us-fields";

/**
 * The patient's relationship to the insured person and, when it is not the
 * patient themselves, who that is: their name and date of birth go on the claim
 * as the subscriber (lib/edi/subscriber.ts). Their address may be left empty
 * when it is the patient's.
 */
export function SubscriberFields({ className }: { className?: string }) {
  const [rel, setRel] = useState("self");
  return (
    <>
      <Field label="Patient's relationship to the insured" className={className}>
        <select name="relationship" className="select" value={rel} onChange={(e) => setRel(e.target.value)}>
          <option value="self">Self (the patient is the insured)</option>
          <option value="spouse">Spouse</option>
          <option value="child">Child</option>
          <option value="other">Other dependent</option>
        </select>
      </Field>
      {rel !== "self" && (
        <fieldset className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:col-span-2 sm:grid-cols-2">
          <legend className="px-1 text-sm font-semibold text-slate-700">The insured person (the subscriber)</legend>
          <Field label="First name"><input name="subscriberFirstName" className="input" required autoComplete="off" /></Field>
          <Field label="Last name"><input name="subscriberLastName" className="input" required autoComplete="off" /></Field>
          <Field label="Date of birth"><input name="subscriberDob" type="date" className="input" required /></Field>
          <Field label="Sex">
            <select name="subscriberSex" className="select" defaultValue="" required>
              <option value="" disabled>Choose...</option>
              <option value="F">Female</option>
              <option value="M">Male</option>
              <option value="U">Unknown</option>
            </select>
          </Field>
          <p className="text-xs text-slate-500 sm:col-span-2">Their address, only if it is not the patient&apos;s:</p>
          <Field label="Address" className="sm:col-span-2"><input name="subscriberAddress1" className="input" autoComplete="off" /></Field>
          <Field label="City"><input name="subscriberCity" className="input" autoComplete="off" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="State"><StateSelect name="subscriberState" /></Field>
            <Field label="ZIP"><ZipInput name="subscriberZip" /></Field>
          </div>
        </fieldset>
      )}
    </>
  );
}
