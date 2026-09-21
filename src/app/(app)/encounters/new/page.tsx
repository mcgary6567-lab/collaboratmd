import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listCodes, listProviders } from "@/server/encounters";
import { searchPatients } from "@/server/patients";
import { PageHeader } from "@/components/ui";
import { ChargeEntryForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewEncounterPage({ searchParams }: { searchParams: Promise<{ patientId?: string; providerId?: string; appointmentId?: string; dos?: string }> }) {
  const sp = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const [{ cpts, icds }, providers, patients] = await Promise.all([listCodes(db), listProviders(db, s.practiceId), searchPatients(db, s.practiceId)]);
  return (
    <>
      <PageHeader title="Charge entry" subtitle="Create an encounter; a claim is built and scrubbed automatically" />
      <ChargeEntryForm
        defaults={{ patientId: sp.patientId, providerId: sp.providerId, appointmentId: sp.appointmentId, dos: sp.dos ?? new Date().toISOString().slice(0, 10) }}
        patients={patients.map((p) => ({ id: p.id, name: `${p.lastName}, ${p.firstName} (${p.mrn})` }))}
        providers={providers.map((p) => ({ id: p.id, name: `Dr. ${p.firstName} ${p.lastName} - ${p.specialty}` }))}
        cpts={cpts.map((c) => ({ code: c.code, description: c.description, fee: c.defaultFeeCents }))}
        icds={icds.map((c) => ({ code: c.code, description: c.description }))}
      />
    </>
  );
}
