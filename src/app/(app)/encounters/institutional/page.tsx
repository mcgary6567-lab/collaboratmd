import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listProviders } from "@/server/encounters";
import { PATIENT_STATUS, TYPES_OF_BILL } from "@/server/institutional";
import { createInstitutionalAction } from "@/app/(app)/institutional-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { PatientPicker } from "@/components/patient-picker";

export const dynamic = "force-dynamic";

const ADMIT_TYPES = [["1", "1 Emergency"], ["2", "2 Urgent"], ["3", "3 Elective"], ["4", "4 Newborn"], ["5", "5 Trauma"], ["9", "9 Unknown"]];
const ADMIT_SOURCES = [["1", "1 Non-health-care point of origin"], ["2", "2 Clinic or physician's office"], ["4", "4 Transfer from a hospital"], ["5", "5 Transfer from SNF or ICF"], ["6", "6 Transfer from another health care facility"], ["7", "7 Emergency room"], ["9", "9 Information not available"]];
const LINES = 8;

export default async function InstitutionalEntryPage() {
  const s = await requireSession();
  const db = await getDb();
  const providers = await listProviders(db, s.practiceId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Facility claim (UB-04)"
        subtitle="Institutional charges by revenue code, sent as an 837I: hospitals, surgery centers, skilled nursing, clinics billing on the UB-04"
        actions={<Link href="/encounters/new" className="btn btn-secondary">Professional charge entry</Link>}
      />
      <ActionForm action={createInstitutionalAction} className="space-y-6">
        <Card title="Patient and bill">
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm md:col-span-1"><span className="label">Patient</span><PatientPicker name="patientId" /></label>
            <label className="block text-sm"><span className="label">Attending provider</span>
              <select name="attending" className="input" required>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.lastName}, {p.firstName} · NPI {p.npi}</option>)}
              </select>
            </label>
            <label className="block text-sm"><span className="label">Type of bill (FL4)</span>
              <select name="tob" className="input" defaultValue="0131" required>
                {TYPES_OF_BILL.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
              </select>
            </label>
            <label className="block text-sm"><span className="label">Statement from (FL6)</span><input type="date" name="from" className="input" max={today} required /></label>
            <label className="block text-sm"><span className="label">Statement through</span><input type="date" name="to" className="input" max={today} /></label>
            <label className="block text-sm"><span className="label">Patient status (FL17)</span>
              <select name="status" className="input" defaultValue="01" required>
                {PATIENT_STATUS.map((p) => <option key={p.code} value={p.code}>{p.label}</option>)}
              </select>
            </label>
          </div>
        </Card>

        <Card title="Admission (inpatient and skilled nursing bills)">
          <div className="grid gap-3 md:grid-cols-5">
            <label className="block text-sm"><span className="label">Admission date (FL12)</span><input type="date" name="admitDate" className="input" max={today} /></label>
            <label className="block text-sm"><span className="label">Hour (FL13)</span><input name="admitHour" className="input" placeholder="1430" maxLength={5} /></label>
            <label className="block text-sm"><span className="label">Type (FL14)</span>
              <select name="admitType" className="input" defaultValue=""><option value="">None</option>{ADMIT_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="block text-sm"><span className="label">Point of origin (FL15)</span>
              <select name="admitSource" className="input" defaultValue=""><option value="">None</option>{ADMIT_SOURCES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            </label>
            <label className="block text-sm"><span className="label">Admitting diagnosis (FL69)</span><input name="admitDx" className="input font-mono" placeholder="R07.9" /></label>
          </div>
        </Card>

        <Card title="Diagnoses and revenue lines">
          <label className="block text-sm"><span className="label">Diagnoses, principal first (FL67)</span><input name="diagnoses" className="input font-mono" placeholder="I21.4, E11.9, I10" required /></label>
          <table className="table mt-4 text-sm">
            <thead><tr><th>#</th><th>Revenue code (FL42)</th><th>HCPCS (FL44)</th><th>Units (FL46)</th><th>Unit charge $ (FL47)</th></tr></thead>
            <tbody>
              {Array.from({ length: LINES }, (_, i) => (
                <tr key={i}>
                  <td className="text-slate-400">{i + 1}</td>
                  <td><input name="rev" className="input w-24 font-mono" placeholder={i === 0 ? "0450" : ""} maxLength={4} inputMode="numeric" /></td>
                  <td><input name="hcpcs" className="input w-28 font-mono" placeholder={i === 0 ? "99284" : ""} maxLength={5} /></td>
                  <td><input name="units" className="input w-20" defaultValue="1" inputMode="numeric" /></td>
                  <td><input name="charge" className="input w-32" placeholder={i === 0 ? "850.00" : ""} inputMode="decimal" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Blank rows are ignored. Common codes: 0450 emergency room, 0300 lab, 0320 radiology, 0360 operating room, 0250 pharmacy, 0120 room and board semi-private, 0710 recovery room.</p>
        </Card>

        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Creating and scrubbing...">Create facility claim</SubmitButton>
          <span className="text-xs text-slate-500">The claim is scrubbed with institutional rules and opens ready to review and submit as an 837I.</span>
        </div>
      </ActionForm>
    </>
  );
}
