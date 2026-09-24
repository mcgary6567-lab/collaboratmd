import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/auth";
import { getDb, schema } from "@/db";
import { listCodes, listProviders } from "@/server/encounters";
import { PageHeader } from "@/components/ui";
import { ChargeEntryForm } from "./form";
import type { PatientOption } from "@/components/patient-picker";

export const dynamic = "force-dynamic";

export default async function NewEncounterPage({ searchParams }: { searchParams: Promise<{ patientId?: string; providerId?: string; appointmentId?: string; dos?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const [{ cpts, icds }, providers] = await Promise.all([listCodes(db, s.practiceId), listProviders(db, s.practiceId)]);

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
      <PageHeader title="Charge entry" subtitle="Create an encounter; a claim is built and scrubbed automatically" />
      <ChargeEntryForm
        defaults={{ providerId: sp.providerId, appointmentId: sp.appointmentId, dos: sp.dos ?? new Date().toISOString().slice(0, 10) }}
        initialPatient={initialPatient}
        providers={providers.map((p) => ({ id: p.id, name: `Dr. ${p.firstName} ${p.lastName} - ${p.specialty}` }))}
        cpts={cpts.map((c) => ({ code: c.code, description: c.description, fee: c.defaultFeeCents }))}
        icds={icds.map((c) => ({ code: c.code, description: c.description }))}
      />
    </>
  );
}
