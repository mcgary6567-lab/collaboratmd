import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { searchPatients } from "@/server/lists";
import { listViews } from "@/server/work";
import { Card, PageHeader, PatientLink, Empty } from "@/components/ui";
import { Pager, SortHeader, pageArgs, type Params } from "@/components/data-table";
import { SavedViews } from "@/components/list-tools";
import { fmtDate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PatientsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const s = await requireSession();
  const db = await getDb();
  const { page, pageSize, offset } = pageArgs(params);
  const [{ rows, total }, views] = await Promise.all([
    searchPatients(db, s.practiceId, { q: params.q, sort: params.sort, dir: params.dir, offset, limit: pageSize }),
    listViews(db, s.userId, s.practiceId, "patients"),
  ]);
  const query = new URLSearchParams(Object.entries(params).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();

  return (
    <>
      <PageHeader
        title="Patients"
        subtitle={`${total.toLocaleString()} patient${total === 1 ? "" : "s"}${params.q ? ` matching "${params.q}"` : ""}`}
        actions={
          <>
            <Link href="/import" className="btn btn-secondary">Import</Link>
            <Link href="/patients/new" className="btn btn-primary">New patient</Link>
          </>
        }
      />
      <Card>
        <form className="mb-3 flex flex-wrap gap-2" action="/patients">
          <input name="q" defaultValue={params.q} placeholder="Name, MRN or phone" className="input max-w-md flex-1" />
          <select name="size" defaultValue={String(pageSize)} className="input w-24" title="Rows per page">
            <option value="25">25</option><option value="50">50</option><option value="100">100</option>
          </select>
          <button className="btn btn-primary">Search</button>
        </form>
        <div className="mb-3"><SavedViews page="patients" query={query} views={views} /></div>
        {rows.length === 0 ? (
          <Empty>No patients match.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="Patient" field="name" base="/patients" params={params} />
                  <SortHeader label="MRN" field="mrn" base="/patients" params={params} />
                  <SortHeader label="DOB" field="dob" base="/patients" params={params} />
                  <th>Sex</th>
                  <th>Phone</th>
                  <th>City</th>
                  <SortHeader label="Added" field="created" base="/patients" params={params} />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td><PatientLink id={p.id} first={p.firstName} last={p.lastName} /></td>
                    <td className="font-mono text-xs">{p.mrn}</td>
                    <td className="whitespace-nowrap">{fmtDate(p.dob + "T00:00:00")}</td>
                    <td>{p.sex}</td>
                    <td className="whitespace-nowrap">{p.phone}</td>
                    <td>{p.city}{p.state ? `, ${p.state}` : ""}</td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{fmtDate(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pageSize={pageSize} total={total} base="/patients" params={params} />
      </Card>
    </>
  );
}
