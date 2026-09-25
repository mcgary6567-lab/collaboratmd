import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listProviders } from "@/server/encounters";
import { COMMON_CDT } from "@/server/dental";
import { createDentalAction } from "@/app/(app)/dental-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { PatientPicker } from "@/components/patient-picker";

export const dynamic = "force-dynamic";

const LINES = 8;
const AREAS = [["", "None"], ["00", "00 Whole mouth"], ["01", "01 Upper arch"], ["02", "02 Lower arch"], ["10", "10 Upper right"], ["20", "20 Upper left"], ["30", "30 Lower left"], ["40", "40 Lower right"]];

export default async function DentalEntryPage() {
  const s = await requireSession();
  const providers = await listProviders(await getDb(), s.practiceId);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title="Dental claim (837D)"
        subtitle="CDT procedures with tooth, surfaces and area of the mouth, sent as an 837D (the ADA claim form's electronic version)"
        actions={<Link href="/encounters/new" className="btn btn-secondary">Medical charge entry</Link>}
      />
      <ActionForm action={createDentalAction} className="space-y-6">
        <Card title="Patient and visit">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-sm md:col-span-2"><span className="label">Patient</span><PatientPicker name="patientId" /></label>
            <label className="block text-sm"><span className="label">Treating dentist</span>
              <select name="providerId" className="input" required>
                {providers.map((p) => <option key={p.id} value={p.id}>{p.lastName}, {p.firstName} · NPI {p.npi}</option>)}
              </select>
            </label>
            <label className="block text-sm"><span className="label">Date of service</span><input type="date" name="dos" className="input" max={today} defaultValue={today} required /></label>
            <label className="block text-sm"><span className="label">Place of service</span>
              <select name="pos" className="input" defaultValue="11"><option value="11">11 Office</option><option value="22">22 Outpatient hospital</option><option value="21">21 Inpatient hospital</option><option value="03">03 School</option><option value="15">15 Mobile unit</option></select>
            </label>
            <label className="block text-sm md:col-span-3"><span className="label">Diagnoses (optional for most dental payers)</span><input name="diagnoses" className="input font-mono" placeholder="K02.52" /></label>
          </div>
        </Card>

        <Card title="Procedures">
          <table className="table text-sm">
            <thead><tr><th>#</th><th>CDT code</th><th>Tooth</th><th>Surfaces</th><th>Area</th><th>Fee $</th></tr></thead>
            <tbody>
              {Array.from({ length: LINES }, (_, i) => (
                <tr key={i}>
                  <td className="text-slate-400">{i + 1}</td>
                  <td><input name="cdt" list="cdt-codes" className="input w-28 font-mono" placeholder={i === 0 ? "D2392" : ""} maxLength={5} /></td>
                  <td><input name="tooth" className="input w-20 font-mono" placeholder={i === 0 ? "30" : ""} maxLength={2} /></td>
                  <td><input name="surfaces" className="input w-24 font-mono" placeholder={i === 0 ? "MO" : ""} maxLength={5} /></td>
                  <td><select name="area" className="input w-40" defaultValue="">{AREAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
                  <td><input name="fee" className="input w-28" placeholder={i === 0 ? "210.00" : ""} inputMode="decimal" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="cdt-codes">{COMMON_CDT.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</datalist>
          <p className="mt-2 text-xs text-slate-500">
            Teeth: 1-32 permanent, A-T primary. Surfaces: M mesial, O occlusal, D distal, B buccal, L lingual, I incisal, F facial. Area: for procedures billed by quadrant (scaling and root planing) or arch. Blank rows are ignored.
          </p>
        </Card>

        <div className="flex items-center gap-3">
          <SubmitButton pendingLabel="Creating and scrubbing...">Create dental claim</SubmitButton>
          <span className="text-xs text-slate-500">Checked with the dental rules: CDT format, tooth numbers, surfaces for fillings, quadrants for periodontal work.</span>
        </div>
      </ActionForm>
    </>
  );
}
