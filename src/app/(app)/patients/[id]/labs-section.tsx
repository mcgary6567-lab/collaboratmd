import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { listPatientOrders } from "@/server/labs";
import { LABS, LAB_TESTS } from "@/lib/labs/catalog";
import { createLabOrderAction } from "@/app/(app)/lab-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, Field } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const LAB_STATUS_TONE: Record<string, "slate" | "blue" | "amber" | "green" | "red"> = {
  ordered: "blue", partial: "amber", resulted: "green", cancelled: "slate",
};

export async function LabsSection({ db, practiceId, patientId }: { db: Db; practiceId: string; patientId: string }) {
  const [orders, providers, lastEncounter] = await Promise.all([
    listPatientOrders(db, practiceId, patientId),
    db.select().from(schema.providers).where(and(eq(schema.providers.practiceId, practiceId), eq(schema.providers.active, true))),
    db.select({ diagnoses: schema.encounters.diagnoses, providerId: schema.encounters.providerId }).from(schema.encounters).where(eq(schema.encounters.patientId, patientId)).orderBy(desc(schema.encounters.dateOfService)).limit(1),
  ]);
  const recentDx = lastEncounter[0]?.diagnoses ?? [];

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-3">
      <Card title="Lab orders" className="lg:col-span-2">
        {orders.length === 0 ? (
          <Empty>No lab orders for this patient.</Empty>
        ) : (
          <table className="table">
            <thead><tr><th>Order</th><th>Date</th><th>Lab</th><th>Tests</th><th>Status</th></tr></thead>
            <tbody>
              {orders.map(({ order, results }) => {
                const abnormal = results.filter((r) => r.flag && r.flag !== "N").length;
                return (
                  <tr key={order.id}>
                    <td><Link href={`/labs/${order.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">{order.placerOrderNumber}</Link></td>
                    <td className="whitespace-nowrap">{fmtDate(order.createdAt)}</td>
                    <td>{LABS.find((l) => l.code === order.labCode)?.name ?? order.labCode}</td>
                    <td className="text-xs">{order.tests.map((t) => t.name).join(", ")}</td>
                    <td>
                      <Badge tone={LAB_STATUS_TONE[order.status] ?? "slate"}>{order.status}</Badge>
                      {abnormal > 0 && <span className="ml-1"><Badge tone="red">{abnormal} abnormal</Badge></span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Order labs">
        <ActionForm action={createLabOrderAction.bind(null, patientId)} className="space-y-3 text-sm">
          <Field label="Lab">
            <select name="labCode" className="input" required>
              {LABS.map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Ordering provider">
            <select name="providerId" className="input" defaultValue={lastEncounter[0]?.providerId} required>
              {providers.map((p) => <option key={p.id} value={p.id}>Dr. {p.firstName} {p.lastName}</option>)}
            </select>
          </Field>
          <fieldset>
            <legend className="label">Tests</legend>
            <div className="grid grid-cols-1 gap-1">
              {LAB_TESTS.map((t) => (
                <label key={t.code} className="flex items-center gap-2">
                  <input type="checkbox" name="tests" value={t.code} /> {t.name} <span className="font-mono text-[10px] text-slate-400">{t.cpt}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Diagnoses (ICD-10)">
            <input name="diagnoses" className="input font-mono" defaultValue={recentDx.join(", ")} placeholder="E11.9, I10" required />
          </Field>
          <SubmitButton pendingLabel="Ordering...">Create order</SubmitButton>
          <p className="text-xs text-slate-500">
            Creates the HL7 order (ORM). Sending it electronically needs an interface with the lab; results sent back to this practice&apos;s HL7 endpoint attach automatically.
          </p>
        </ActionForm>
      </Card>
    </div>
  );
}
