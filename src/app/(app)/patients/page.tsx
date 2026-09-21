import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { searchPatients } from "@/server/patients";
import { Card, PageHeader, PatientLink, Empty } from "@/components/ui";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PatientsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const rows = await searchPatients(db, s.practiceId, q);
  return (
    <>
      <PageHeader
        title="Patients"
        subtitle={`${rows.length} patient${rows.length === 1 ? "" : "s"}`}
        actions={
          <Link href="/patients/new" className="btn btn-primary">
            New patient
          </Link>
        }
      />
      <Card>
        <form className="mb-4 flex gap-2">
          <input name="q" defaultValue={q} placeholder="Search by name or MRN" className="input max-w-sm" />
          <button className="btn btn-secondary">Search</button>
        </form>
        {rows.length === 0 ? (
          <Empty>No patients match.</Empty>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Patient</th>
                <th>MRN</th>
                <th>DOB</th>
                <th>Sex</th>
                <th>Phone</th>
                <th>City</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <PatientLink id={p.id} first={p.firstName} last={p.lastName} />
                  </td>
                  <td className="font-mono text-xs">{p.mrn}</td>
                  <td>{fmtDate(p.dob + "T00:00:00")}</td>
                  <td>{p.sex}</td>
                  <td>{p.phone}</td>
                  <td>{p.city}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
