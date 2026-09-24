import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { getLabOrder } from "@/server/labs";
import { LABS } from "@/lib/labs/catalog";
import { cancelLabAction, reviewLabAction, simulateLabAction } from "@/app/(app)/lab-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Badge, Card, Empty, PageHeader, PatientLink } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { LAB_STATUS_TONE } from "@/app/(app)/patients/[id]/labs-section";

export const dynamic = "force-dynamic";

const FLAG: Record<string, { label: string; className: string }> = {
  L: { label: "Low", className: "text-blue-700" },
  H: { label: "High", className: "text-red-700" },
  LL: { label: "Critical low", className: "font-bold text-blue-800" },
  HH: { label: "Critical high", className: "font-bold text-red-800" },
  A: { label: "Abnormal", className: "text-red-700" },
};

export default async function LabOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireSession();
  const db = await getDb();
  const data = await getLabOrder(db, s.practiceId, id);
  if (!data) notFound();
  const { order, patient, provider, results } = data;
  const byTest = order.tests.map((t) => ({ test: t, rows: results.filter((r) => r.testCode === t.code) }));
  const simulated = order.fillerOrderNumber?.startsWith("SIM-");

  return (
    <>
      <PageHeader
        title={`Lab order ${order.placerOrderNumber}`}
        subtitle={`${LABS.find((l) => l.code === order.labCode)?.name} · ordered ${fmtDateTime(order.createdAt)} by Dr. ${provider.lastName}`}
        actions={
          <>
            <Badge tone={LAB_STATUS_TONE[order.status] ?? "slate"}>{order.status}</Badge>
            {order.reviewedAt && <Badge tone="green">Reviewed</Badge>}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {simulated && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              These results were produced by the demo simulator, not by a laboratory. They are not real patient results.
            </div>
          )}
          {byTest.map(({ test, rows }) => (
            <Card key={test.code} title={`${test.name} · CPT ${test.cpt}`}>
              {rows.length === 0 ? (
                <Empty>Waiting on the lab.</Empty>
              ) : (
                <table className="table">
                  <thead><tr><th>Component</th><th className="text-right">Result</th><th>Units</th><th>Reference</th><th>Flag</th><th>LOINC</th></tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const f = r.flag ? FLAG[r.flag] : undefined;
                      return (
                        <tr key={r.id}>
                          <td>{r.name}{r.status === "C" && <span className="ml-1 text-[10px] text-slate-500">(corrected)</span>}</td>
                          <td className={`text-right tabular-nums ${f?.className ?? ""}`}>{r.value}</td>
                          <td className="text-xs">{r.units}</td>
                          <td className="text-xs">{r.referenceRange}</td>
                          <td className={`text-xs ${f?.className ?? ""}`}>{f?.label ?? ""}</td>
                          <td className="font-mono text-[10px] text-slate-500">{r.loinc}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Card>
          ))}
          <Card title="HL7 order (ORM^O01)">
            <pre className="max-h-64 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] text-green-200">{order.ormMessage.replace(/\r/g, "\n")}</pre>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Patient">
            <PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} mrn={patient.mrn} />
            <div className="mt-2 text-sm text-slate-600">Diagnoses: <span className="font-mono">{order.diagnoses.join(", ")}</span></div>
            {order.fillerOrderNumber && <div className="text-sm text-slate-600">Lab accession: <span className="font-mono">{order.fillerOrderNumber}</span></div>}
          </Card>
          <Card title="Actions">
            <div className="space-y-3">
              {results.length > 0 && !order.reviewedAt && (
                <form action={reviewLabAction.bind(null, order.id)}>
                  <button className="btn btn-primary w-full justify-center">Mark results reviewed</button>
                </form>
              )}
              {order.status === "ordered" && (
                <form action={cancelLabAction.bind(null, order.id)}>
                  <button className="btn btn-secondary w-full justify-center">Cancel order</button>
                </form>
              )}
              {order.status === "ordered" && results.length === 0 && (
                <div className="rounded-lg border border-dashed border-amber-300 p-3">
                  <div className="mb-1 text-xs font-semibold uppercase text-amber-800">Demo only</div>
                  <p className="mb-2 text-xs text-slate-600">No lab is connected. Generate the result message a lab would send, and process it through the real HL7 path.</p>
                  <ActionForm action={simulateLabAction.bind(null, order.id)}>
                    <SubmitButton className="btn btn-secondary w-full justify-center text-xs" pendingLabel="Simulating...">Simulate a lab result</SubmitButton>
                  </ActionForm>
                </div>
              )}
            </div>
          </Card>
          <Link href="/labs" className="btn btn-secondary w-full justify-center">Back to labs</Link>
        </div>
      </div>
    </>
  );
}
