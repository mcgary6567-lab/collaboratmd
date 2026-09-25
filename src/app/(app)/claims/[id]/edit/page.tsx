import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { listCodes } from "@/server/encounters";
import { EDITABLE } from "@/server/claim-edit";
import { loadClaimBundle } from "@/server/claims";
import { Alert, PageHeader } from "@/components/ui";
import { ClaimEditForm } from "./edit-form";

export const dynamic = "force-dynamic";

export default async function EditClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const b = await loadClaimBundle(db, id);
  if (!b || b.claim.practiceId !== s.practiceId) notFound();
  const editable = (EDITABLE as readonly string[]).includes(b.claim.status) && b.claim.frequencyCode !== "8" && b.claim.payerSequence !== "S";
  const [{ cpts, icds }, lines] = await Promise.all([
    listCodes(db, s.practiceId),
    db.select().from(schema.charges).where(eq(schema.charges.encounterId, b.claim.encounterId)).orderBy(asc(schema.charges.lineNumber)),
  ]);
  return (
    <>
      <PageHeader title={`Edit claim ${b.claim.controlNumber}`} subtitle={`${b.patient.lastName}, ${b.patient.firstName} · ${b.payer.name}`} actions={<Link href={`/claims/${id}`} className="btn btn-secondary">Back to claim</Link>} />
      {editable ? (
        <ClaimEditForm
          claimId={id}
          initial={{ dateOfService: b.encounter.dateOfService, placeOfService: b.encounter.placeOfService, diagnoses: b.encounter.diagnoses, lines }}
          cpts={cpts.map((c) => ({ code: c.code, description: c.description, fee: c.defaultFeeCents }))}
          icds={icds.map((c) => ({ code: c.code, description: c.description }))}
        />
      ) : (
        <Alert kind="info">A payer has already received or decided this claim, so it cannot be edited. Create a corrected claim from the claim page instead.</Alert>
      )}
    </>
  );
}
