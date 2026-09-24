import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { standardCharges } from "@/server/fees";
import { createEstimateAction } from "@/app/(app)/billing-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, Empty, Field, PageHeader } from "@/components/ui";
import { money } from "@/lib/utils";

export const dynamic = "force-dynamic";

const ROWS = 6;

export default async function NewEstimatePage({ searchParams }: { searchParams: Promise<{ patientId?: string }> }) {
  const { patientId } = await searchParams;
  const s = await requireSession();
  const db = await getDb();

  const [patient] = patientId
    ? await db.select().from(schema.patients).where(and(eq(schema.patients.id, patientId), eq(schema.patients.practiceId, s.practiceId))).limit(1)
    : [];
  if (!patient) {
    return (
      <>
        <PageHeader title="New estimate" />
        <Empty>
          Start an estimate from a patient&apos;s record, so it uses their coverage.{" "}
          <Link href="/patients" className="font-semibold text-brand-700 hover:underline">Find a patient</Link>
        </Empty>
      </>
    );
  }

  const [insurances, codes, fees] = await Promise.all([
    db.select({ ins: schema.patientInsurances, payer: schema.payers })
      .from(schema.patientInsurances)
      .innerJoin(schema.payers, eq(schema.payers.id, schema.patientInsurances.payerId))
      .where(and(eq(schema.patientInsurances.patientId, patient.id), eq(schema.patientInsurances.active, true)))
      .orderBy(asc(schema.patientInsurances.rank)),
    db.select().from(schema.cptCodes).orderBy(asc(schema.cptCodes.code)),
    standardCharges(db, s.practiceId),
  ]);

  return (
    <>
      <PageHeader
        title="New estimate"
        subtitle={`For ${patient.firstName} ${patient.lastName} · ${patient.mrn}`}
        actions={<Link href={`/patients/${patient.id}`} className="btn btn-secondary">Cancel</Link>}
      />
      <Card>
        <ActionForm action={createEstimateAction} className="space-y-5">
          <input type="hidden" name="patientId" value={patient.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Coverage">
              <select name="patientInsuranceId" className="select" defaultValue={insurances[0]?.ins.id ?? "self_pay"}>
                {insurances.map(({ ins, payer }) => (
                  <option key={ins.id} value={ins.id}>{payer.name} · member {ins.memberId}</option>
                ))}
                <option value="self_pay">Uninsured or self-pay (good faith estimate)</option>
              </select>
            </Field>
            <Field label="Planned date of service">
              <input name="serviceDate" type="date" className="input" />
            </Field>
          </div>

          <div>
            <div className="label">Services</div>
            <div className="space-y-2">
              {Array.from({ length: ROWS }, (_, i) => (
                <div key={i} className="grid grid-cols-[1fr_6rem] gap-2">
                  <select name="cpt" className="select" defaultValue="">
                    <option value="">{i === 0 ? "Choose a service" : "Add another service (optional)"}</option>
                    {codes.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} · {c.description} · {money(fees.get(c.code) ?? c.defaultFeeCents)}
                      </option>
                    ))}
                  </select>
                  <input name="units" type="number" min="1" max="99" defaultValue="1" className="input" aria-label="Units" />
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-500">
            For an insured patient, benefits are verified with the payer if the last check is more than a week
            old, and allowed amounts come from the payer contract.
          </p>
          <SubmitButton pendingLabel="Verifying benefits...">Create estimate</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
