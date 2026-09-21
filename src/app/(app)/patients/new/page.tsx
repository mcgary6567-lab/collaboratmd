import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listPayers } from "@/server/encounters";
import { PageHeader } from "@/components/ui";
import { NewPatientForm } from "./form";

export const dynamic = "force-dynamic";

export default async function NewPatientPage() {
  const s = await requireSession();
  const db = await getDb();
  const payers = await listPayers(db, s.practiceId);
  return (
    <>
      <PageHeader title="Register patient" subtitle="Demographics and primary insurance" />
      <NewPatientForm payers={payers.map((p) => ({ id: p.id, name: p.name }))} />
    </>
  );
}
