import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { getSession } from "@/lib/auth";
import { listClaims } from "@/server/claims";

export const dynamic = "force-dynamic";

/** Read-only claims API for integrations (session-authenticated). */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const status = new URL(req.url).searchParams.get("status") ?? undefined;
  const db = await getDb();
  const rows = await listClaims(db, session.practiceId, status);
  return NextResponse.json(
    rows.map(({ claim, patient, payer, encounter }) => ({
      id: claim.id,
      controlNumber: claim.controlNumber,
      status: claim.status,
      frequencyCode: claim.frequencyCode,
      totalCents: claim.totalCents,
      dateOfService: encounter.dateOfService,
      payer: { name: payer.name, payerId: payer.payerId },
      patient: { mrn: patient.mrn, lastName: patient.lastName, firstName: patient.firstName },
      payerClaimNumber: claim.payerClaimNumber,
      submittedAt: claim.submittedAt,
      scrubErrors: claim.scrubResults.filter((f) => f.severity === "error").length,
    })),
  );
}
