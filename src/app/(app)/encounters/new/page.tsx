import type { Metadata } from "next";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { getDb, schema } from "@/db";
import { listCodes, listProviders } from "@/server/encounters";
import { listLocations } from "@/server/locations";
import { PageHeader } from "@/components/ui";
import { ChargeEntryForm } from "./form";
import type { PatientOption } from "@/components/patient-picker";

export const metadata: Metadata = { title: "Charge entry" };

export const dynamic = "force-dynamic";

export default async function NewEncounterPage({ searchParams }: { searchParams: Promise<{ patientId?: string; providerId?: string; appointmentId?: string; dos?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const [{ cpts, icds }, providers, locations] = await Promise.all([listCodes(db, s.practiceId), listProviders(db, s.practiceId), listLocations(db, s.practiceId, { activeOnly: true })]);
  // A visit booked at a location starts there.
  let locationId: string | null = null;
  if (sp.appointmentId) {
    const [a] = await db.select({ locationId: schema.appointments.locationId, practiceId: schema.appointments.practiceId }).from(schema.appointments).where(eq(schema.appointments.id, sp.appointmentId)).limit(1);
    if (a?.practiceId === s.practiceId) locationId = a.locationId;
  }

  // When arriving from a check-in the patient is already known; otherwise the
  // form searches on demand rather than loading the whole roster.
  let initialPatient: PatientOption | null = null;
  if (sp.patientId) {
    const [p] = await db.select().from(schema.patients).where(eq(schema.patients.id, sp.patientId)).limit(1);
    if (p && p.practiceId === s.practiceId) {
      initialPatient = { id: p.id, label: `${p.lastName}, ${p.firstName}`, mrn: p.mrn, dob: p.dob };
    }
  }

  return (
    <>
      <PageHeader title="Charge entry" subtitle="Create an encounter; a claim is built and scrubbed automatically" actions={<Link href="/coding" className="btn btn-secondary">Coding help</Link>} />
      <ChargeEntryForm
        defaults={{ providerId: sp.providerId, appointmentId: sp.appointmentId, dos: sp.dos ?? new Date().toISOString().slice(0, 10), locationId }}
        locations={locations.map((l) => ({ id: l.id, name: `${l.name} (${l.city})`, placeOfService: l.placeOfService }))}
        initialPatient={initialPatient}
        providers={providers.map((p) => ({ id: p.id, name: `Dr. ${p.firstName} ${p.lastName} - ${p.specialty}` }))}
        cpts={cpts.map((c) => ({ code: c.code, description: c.description, fee: c.defaultFeeCents }))}
        icds={icds.map((c) => ({ code: c.code, description: c.description }))}
      />
    </>
  );
}
