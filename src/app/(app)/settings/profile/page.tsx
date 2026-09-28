import type { Metadata } from "next";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { saveProfileAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { timeZoneName, US_TIME_ZONES } from "@/server/practice-time";
import { PhoneInput, StateSelect, ZipInput } from "@/components/us-fields";
import { fmtPhone } from "@/lib/us";
import { BillingEntityFields } from "./billing-entity";
import { NpiLookup } from "@/components/npi-lookup";

export const metadata: Metadata = { title: "Practice profile" };

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const s = await requireSession();
  const [p] = await (await getDb()).select().from(schema.practices).where(eq(schema.practices.id, s.practiceId)).limit(1);
  const admin = s.role === "admin";
  const field = (name: keyof typeof p, label: string, extra: { placeholder?: string; className?: string; maxLength?: number; inputMode?: "numeric" } = {}) => (
    <label className={`block text-sm ${extra.className ?? ""}`}>
      <span className="label">{label}</span>
      <input name={name} defaultValue={String(p[name] ?? "")} className="input" placeholder={extra.placeholder} maxLength={extra.maxLength} inputMode={extra.inputMode} disabled={!admin} required={name !== "phone"} />
    </label>
  );
  return (
    <>
      <PageHeader title="Practice profile" subtitle="The billing provider on every claim (loop 2010AA). Payers reject claims when these do not match enrollment." />
      <Card>
        <ActionForm action={saveProfileAction} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {field("name", "Legal name, as enrolled with payers", { className: "md:col-span-2" })}
            <BillingEntityFields entity={p.billingEntity} firstName={p.billingFirstName} lastName={p.billingLastName} disabled={!admin} />
            {field("npi", p.billingEntity === "individual" ? "Billing NPI" : "Group NPI (Type 2)", { maxLength: 10, inputMode: "numeric", placeholder: "10 digits" })}
            {field("taxId", "Tax ID (EIN)", { placeholder: "12-3456789", maxLength: 10 })}
            {admin && <div className="md:col-span-2"><NpiLookup fill={{ name: "name", address1: "address1", city: "city", state: "state", zip: "zip", phone: "phone", billingFirstName: "firstName", billingLastName: "lastName" }} /></div>}
            {field("address1", "Street address (not a PO box)", { className: "md:col-span-2" })}
            {field("city", "City")}
            <div className="grid grid-cols-2 gap-4">
              <label className="block text-sm">
                <span className="label">State</span>
                <StateSelect defaultValue={p.state} required disabled={!admin} className="input" />
              </label>
              <label className="block text-sm">
                <span className="label">ZIP</span>
                <ZipInput defaultValue={p.zip} required disabled={!admin} />
              </label>
            </div>
            <label className="block text-sm">
              <span className="label">Billing phone</span>
              <PhoneInput defaultValue={fmtPhone(p.phone)} disabled={!admin} />
            </label>
            <label className="block text-sm">
              <span className="label">CLIA number</span>
              <input name="cliaNumber" defaultValue={p.cliaNumber ?? ""} className="input" placeholder="10D1234567" maxLength={10} pattern="\d{2}[Dd]\d{7}" title="Two digits, the letter D, then seven digits" disabled={!admin} />
              <span className="mt-1 block text-xs text-slate-500">Only if you bill lab tests (CPT 80000-89999). Sent with those claims; Medicare rejects them without it.</span>
            </label>
            <fieldset className="md:col-span-2">
              <legend className="label">Paper claim alignment (CMS-1500)</legend>
              <div className="flex flex-wrap items-end gap-4 text-sm">
                <label className="block"><span className="text-xs text-slate-500">Move right (mm)</span><input name="formOffsetX" type="number" step="0.5" min={-25} max={25} defaultValue={p.formOffsetX / 10} className="input w-28" disabled={!admin} /></label>
                <label className="block"><span className="text-xs text-slate-500">Move down (mm)</span><input name="formOffsetY" type="number" step="0.5" min={-25} max={25} defaultValue={p.formOffsetY / 10} className="input w-28" disabled={!admin} /></label>
                <span className="text-xs text-slate-500">Print the alignment test from any claim&apos;s paper claim page on a red form; negative numbers move left or up.</span>
              </div>
            </fieldset>
            <label className="block text-sm">
              <span className="label">Time zone</span>
              <select name="timeZone" defaultValue={p.timeZone} className="input" disabled={!admin}>
                {[...new Set([p.timeZone, ...US_TIME_ZONES])].map((z) => <option key={z} value={z}>{timeZoneName(z)}</option>)}
              </select>
              <span className="mt-1 block text-xs text-slate-500">Decides which day is today on the schedule, when reminders go out for tomorrow, and online booking times.</span>
            </label>
          </div>
          {admin ? (
            <div className="flex items-center gap-3">
              <SubmitButton pendingLabel="Checking and saving...">Save profile</SubmitButton>
              <span className="text-xs text-slate-500">The NPI is checked against its check digit. Every change is recorded in the audit log with the old value.</span>
            </div>
          ) : <p className="text-sm text-slate-500">An administrator can change these.</p>}
        </ActionForm>
      </Card>
    </>
  );
}
