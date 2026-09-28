import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { getPatient } from "@/server/patients";
import { patientAccessLog } from "@/server/access-log";
import { Card, Empty, PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/action-form";
import { fmtDateTime } from "@/lib/utils";

export const metadata: Metadata = { title: "Chart access" };

export const dynamic = "force-dynamic";

/** Who opened this patient's records and what was done with them. Administrators only. */
export default async function PatientAccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireRole(["admin"]);
  const db = await getDb();
  const data = await getPatient(db, s.practiceId, id);
  if (!data) notFound();
  const { patient } = data;
  const log = await patientAccessLog(db, s.practiceId, patient.id);
  return (
    <>
      <PageHeader
        title={`Access log: ${patient.lastName}, ${patient.firstName}`}
        subtitle={`MRN ${patient.mrn}. Who opened this patient's records, and what was done with them.`}
        actions={<><Link href={`/patients/${patient.id}`} className="btn btn-secondary">Back to the chart</Link><PrintButton label="Print" /></>}
      />
      <Card title="Access and activity">
        <p className="mb-3 text-xs text-slate-500">
          Opening the chart, a claim, a statement or an estimate is recorded (the same person reopening the same record within 15 minutes is recorded once), along with links sent, statements mailed, attachments opened and changes. This is the practice&apos;s internal access log. It is not the accounting of disclosures a patient can request, which covers disclosures outside the practice.
        </p>
        {log.entries.length === 0 ? <Empty>Nothing recorded for this patient yet.</Empty> : (
          <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto">
            <table className="table text-sm">
              <thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead>
              <tbody>
                {log.entries.map((e, i) => (
                  <tr key={i}><td className="whitespace-nowrap">{fmtDateTime(e.at, s.timeZone)}</td><td>{e.who}</td><td>{e.what}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {log.truncated && <p className="mt-2 text-xs text-slate-500">Showing the most recent 500 entries. The full record is in Settings &gt; Audit log.</p>}
      </Card>
      <Card title="Full practice exports in the same period" className="mt-6">
        <p className="mb-3 text-xs text-slate-500">A full export contains every patient, this one included.</p>
        {log.exports.length === 0 ? <Empty>None.</Empty> : (
          <ul className="space-y-1 text-sm">
            {log.exports.map((x, i) => <li key={i}>{fmtDateTime(x.at, s.timeZone)} · {x.name ?? "Unknown"}{x.email ? ` <${x.email}>` : ""} · {x.action === "export" ? "prepared an export" : "downloaded an export"}</li>)}
          </ul>
        )}
      </Card>
    </>
  );
}
