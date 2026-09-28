import type { Metadata } from "next";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { listLocations } from "@/server/locations";
import { saveLocationAction, setLocationActiveAction } from "@/app/(app)/location-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { PosOptions } from "@/components/code-pickers";
import { StateSelect, ZipInput } from "@/components/us-fields";
import { NpiLookup } from "@/components/npi-lookup";

export const metadata: Metadata = { title: "Locations" };

export const dynamic = "force-dynamic";

type Loc = Awaited<ReturnType<typeof listLocations>>[number];

function LocationFields({ l }: { l?: Loc }) {
  return (
    <div className="grid gap-3 sm:grid-cols-6">
      <label className="block sm:col-span-2"><span className="label">Name</span><input name="name" defaultValue={l?.name} className="input" required placeholder="Northside Clinic" /></label>
      <label className="block sm:col-span-2"><span className="label">Facility NPI (if it has its own)</span><input name="npi" defaultValue={l?.npi ?? ""} className="input" inputMode="numeric" /></label>
      <label className="block sm:col-span-2"><span className="label">Place of service</span><select name="placeOfService" defaultValue={l?.placeOfService ?? "11"} className="select"><PosOptions /></select></label>
      <label className="block sm:col-span-3"><span className="label">Street address</span><input name="address1" defaultValue={l?.address1} className="input" required /></label>
      <label className="block sm:col-span-1"><span className="label">City</span><input name="city" defaultValue={l?.city} className="input" required /></label>
      <label className="block sm:col-span-1"><span className="label">State</span><StateSelect defaultValue={l?.state} required className="select" /></label>
      <label className="block sm:col-span-1"><span className="label">ZIP (9 digits preferred)</span><ZipInput defaultValue={l?.zip} required /></label>
      <div className="sm:col-span-6"><NpiLookup fill={{ name: "name", address1: "address1", city: "city", state: "state", zip: "zip" }} /></div>
    </div>
  );
}

export default async function LocationsPage() {
  const s = await requireRole(["admin"]);
  const rows = await listLocations(await getDb(), s.practiceId);
  return (
    <>
      <PageHeader title="Locations" subtitle="Where you see patients. Charge entry asks for the location, and claims for visits away from your billing address name it as the service facility." />
      <div className="space-y-6">
        <Card title="Add a location">
          <ActionForm action={saveLocationAction.bind(null, null)} className="space-y-3 text-sm">
            <LocationFields />
            <SubmitButton pendingLabel="Adding...">Add location</SubmitButton>
          </ActionForm>
        </Card>
        {rows.length === 0 ? (
          <Card><Empty>No extra locations. With none, every claim uses the practice&apos;s billing address, which is right for a single office.</Empty></Card>
        ) : rows.map((l) => (
          <Card key={l.id} title={l.name} actions={<Badge tone={l.active ? "green" : "slate"}>{l.active ? "active" : "inactive"}</Badge>}>
            <ActionForm action={saveLocationAction.bind(null, l.id)} className="space-y-3 text-sm">
              <LocationFields l={l} />
              <div className="flex gap-2"><SubmitButton pendingLabel="Saving...">Save</SubmitButton></div>
            </ActionForm>
            <div className="mt-2">
              <ActionForm action={setLocationActiveAction.bind(null, l.id, !l.active)}><SubmitButton className="btn btn-secondary text-xs" pendingLabel="...">{l.active ? "Deactivate" : "Reactivate"}</SubmitButton></ActionForm>
            </div>
          </Card>
        ))}
        <p className="text-xs text-slate-500">Most payers expect the service facility&apos;s 9-digit ZIP code. Visits at the billing address need no location; the claim then leaves the service facility out, which payers read as the billing address.</p>
      </div>
    </>
  );
}
