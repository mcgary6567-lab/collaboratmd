import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { labWorklist } from "@/server/labs";
import { LABS } from "@/lib/labs/catalog";
import { Badge, Card, Empty, PageHeader, PatientLink } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { LAB_STATUS_TONE } from "@/app/(app)/patients/[id]/labs-section";

export const dynamic = "force-dynamic";

export default async function LabsPage() {
  const s = await requireSession();
  const db = await getDb();
  const rows = await labWorklist(db, s.practiceId);
  const toReview = rows.filter((r) => r.resultCount > 0).sort((a, b) => b.abnormal - a.abnormal);
  const waiting = rows.filter((r) => r.resultCount === 0);

  const table = (list: typeof rows) => (
    <table className="table">
      <thead><tr><th>Order</th><th>Patient</th><th>Lab</th><th>Tests</th><th>Ordered</th><th>Status</th></tr></thead>
      <tbody>
        {list.map(({ order, patient, abnormal }) => (
          <tr key={order.id}>
            <td><Link href={`/labs/${order.id}`} className="font-mono text-xs font-semibold text-brand-700 hover:underline">{order.placerOrderNumber}</Link></td>
            <td><PatientLink id={patient.id} first={patient.firstName} last={patient.lastName} /></td>
            <td className="text-xs">{LABS.find((l) => l.code === order.labCode)?.name}</td>
            <td className="text-xs">{order.tests.map((t) => t.code).join(", ")}</td>
            <td className="whitespace-nowrap text-xs">{fmtDateTime(order.createdAt)}</td>
            <td>
              <Badge tone={LAB_STATUS_TONE[order.status] ?? "slate"}>{order.status}</Badge>
              {abnormal > 0 && <span className="ml-1"><Badge tone="red">{abnormal} abnormal</Badge></span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <>
      <PageHeader title="Labs" subtitle="Results to review and orders waiting on the lab" />
      <div className="space-y-6">
        <Card title={`Results to review (${toReview.length})`}>{toReview.length ? table(toReview) : <Empty>No results waiting for review.</Empty>}</Card>
        <Card title={`Waiting on the lab (${waiting.length})`}>{waiting.length ? table(waiting) : <Empty>No open orders. Order labs from a patient&apos;s page.</Empty>}</Card>
        <Card title="Lab connections">
          <ul className="space-y-1 text-sm">
            {LABS.map((l) => (
              <li key={l.code} className="flex items-center justify-between">
                <span>{l.name}</span>
                <Badge>{l.code === "INOFFICE" ? "Results by HL7 or entry" : "Not connected"}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">
            Electronic ordering and results with a reference lab need an account and an interface agreement with that lab. Orders are generated as HL7
            ORM messages now; once a lab is connected, its ORU results arrive on this practice&apos;s HL7 endpoint and attach to the order automatically.
          </p>
        </Card>
      </div>
    </>
  );
}
