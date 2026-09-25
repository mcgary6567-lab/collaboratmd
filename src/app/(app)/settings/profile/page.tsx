import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { saveProfileAction } from "@/app/(app)/admin-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";

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
            {field("npi", "Group NPI (Type 2)", { maxLength: 10, inputMode: "numeric", placeholder: "10 digits" })}
            {field("taxId", "Tax ID (EIN)", { placeholder: "12-3456789", maxLength: 10 })}
            {field("address1", "Street address (not a PO box)", { className: "md:col-span-2" })}
            {field("city", "City")}
            <div className="grid grid-cols-2 gap-4">
              {field("state", "State", { maxLength: 2, placeholder: "TX" })}
              {field("zip", "ZIP", { maxLength: 10, placeholder: "75201 or 75201-1234" })}
            </div>
            {field("phone", "Billing phone")}
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
