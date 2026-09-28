"use client";

import { useState } from "react";

/** Who bills: the practice (group NPI) or a solo provider under their own NPI, whose name then goes on claims. */
export function BillingEntityFields({ entity, firstName, lastName, disabled }: { entity: string; firstName: string | null; lastName: string | null; disabled: boolean }) {
  const [individual, setIndividual] = useState(entity === "individual");
  return (
    <fieldset className="space-y-3 md:col-span-2">
      <legend className="label">Claims are billed by</legend>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="billingEntity" value="organization" checked={!individual} onChange={() => setIndividual(false)} disabled={disabled} />
          The practice (a group, Type 2 NPI)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="billingEntity" value="individual" checked={individual} onChange={() => setIndividual(true)} disabled={disabled} />
          A solo provider under their own NPI (Type 1)
        </label>
      </div>
      {individual && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="label">Provider&apos;s first name</span>
            <input name="billingFirstName" defaultValue={firstName ?? ""} className="input" required disabled={disabled} autoComplete="off" />
          </label>
          <label className="block text-sm">
            <span className="label">Provider&apos;s last name</span>
            <input name="billingLastName" defaultValue={lastName ?? ""} className="input" required disabled={disabled} autoComplete="off" />
          </label>
          <p className="text-xs text-slate-500 md:col-span-2">As enrolled with NPPES. The billing NPI below must then be this provider&apos;s own (Type 1).</p>
        </div>
      )}
    </fieldset>
  );
}
