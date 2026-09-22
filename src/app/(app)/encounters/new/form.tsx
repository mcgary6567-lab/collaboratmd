"use client";

import { useActionState, useState } from "react";
import { Trash2, Plus } from "lucide-react";
import { createEncounterAction } from "@/app/(app)/actions";
import { Field, Alert } from "@/components/ui";
import { PatientPicker, type PatientOption } from "@/components/patient-picker";

type Line = { cpt: string; modifiers: string; units: number; charge: string; dxPointers: string; description: string };

const POS = [
  ["11", "11 - Office"],
  ["02", "02 - Telehealth (other than home)"],
  ["10", "10 - Telehealth in patient home"],
  ["12", "12 - Home"],
  ["19", "19 - Off-campus outpatient hospital"],
  ["21", "21 - Inpatient hospital"],
  ["22", "22 - On-campus outpatient hospital"],
  ["23", "23 - Emergency room"],
  ["24", "24 - Ambulatory surgical center"],
  ["31", "31 - Skilled nursing facility"],
];

export function ChargeEntryForm({
  defaults,
  initialPatient,
  providers,
  cpts,
  icds,
}: {
  defaults: { providerId?: string; appointmentId?: string; dos: string };
  initialPatient: PatientOption | null;
  providers: { id: string; name: string }[];
  cpts: { code: string; description: string; fee: number }[];
  icds: { code: string; description: string }[];
}) {
  const [state, action, pending] = useActionState(createEncounterAction, undefined);
  const [patientId, setPatientId] = useState(initialPatient?.id ?? "");
  const [providerId, setProviderId] = useState(defaults.providerId ?? providers[0]?.id ?? "");
  const [dos, setDos] = useState(defaults.dos);
  const [pos, setPos] = useState("11");
  const [dx, setDx] = useState<string[]>([""]);
  const [lines, setLines] = useState<Line[]>([{ cpt: "", modifiers: "", units: 1, charge: "", dxPointers: "1", description: "" }]);

  const feeFor = (code: string) => cpts.find((c) => c.code === code)?.fee;
  const updateLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + (parseFloat(l.charge) || 0) * (l.units || 1), 0);

  const payload = JSON.stringify({
    patientId,
    providerId,
    appointmentId: defaults.appointmentId ?? null,
    dateOfService: dos,
    placeOfService: pos,
    diagnoses: dx.map((d) => d.trim()).filter(Boolean),
    lines: lines
      .filter((l) => l.cpt.trim())
      .map((l) => ({
        cpt: l.cpt.trim(),
        modifiers: l.modifiers.split(",").map((m) => m.trim()).filter(Boolean),
        units: Number(l.units) || 1,
        chargeCents: Math.round((parseFloat(l.charge) || 0) * 100),
        dxPointers: l.dxPointers.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => !Number.isNaN(n)),
        description: l.description || cpts.find((c) => c.code === l.cpt)?.description,
      })),
  });

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      {state && !state.ok && <Alert kind="error">{state.message}</Alert>}
      <div className="card grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Patient">
          <PatientPicker initial={initialPatient} onSelect={(p) => setPatientId(p?.id ?? "")} />
        </Field>
        <Field label="Rendering provider">
          <select className="select" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Date of service"><input type="date" className="input" value={dos} onChange={(e) => setDos(e.target.value)} /></Field>
        <Field label="Place of service">
          <select className="select" value={pos} onChange={(e) => setPos(e.target.value)}>
            {POS.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Diagnoses (ICD-10-CM)</h2>
          <button type="button" className="btn btn-secondary text-xs" onClick={() => setDx((d) => [...d, ""])} disabled={dx.length >= 12}>
            <Plus className="h-3.5 w-3.5" /> Add diagnosis
          </button>
        </div>
        <datalist id="icd-list">
          {icds.map((c) => (
            <option key={c.code} value={c.code}>{c.description}</option>
          ))}
        </datalist>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dx.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-xs font-semibold text-slate-400">{i + 1}</span>
              <input list="icd-list" className="input font-mono" placeholder="e.g. E11.9" value={d} onChange={(e) => setDx((arr) => arr.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))} />
              <span className="hidden min-w-0 flex-1 truncate text-xs text-slate-500 lg:inline">{icds.find((c) => c.code === d)?.description}</span>
              {dx.length > 1 && (
                <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setDx((arr) => arr.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Service lines (CPT / HCPCS)</h2>
          <button type="button" className="btn btn-secondary text-xs" onClick={() => setLines((ls) => [...ls, { cpt: "", modifiers: "", units: 1, charge: "", dxPointers: "1", description: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        </div>
        <datalist id="cpt-list">
          {cpts.map((c) => (
            <option key={c.code} value={c.code}>{c.description}</option>
          ))}
        </datalist>
        <table className="table">
          <thead>
            <tr><th>#</th><th>CPT</th><th>Description</th><th>Modifiers</th><th>Units</th><th>Charge ($)</th><th>Dx ptr</th><th></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="text-slate-400">{i + 1}</td>
                <td className="w-32">
                  <input list="cpt-list" className="input font-mono" value={l.cpt} onChange={(e) => {
                    const code = e.target.value.toUpperCase();
                    const fee = feeFor(code);
                    updateLine(i, { cpt: code, charge: fee !== undefined ? (fee / 100).toFixed(2) : l.charge });
                  }} />
                </td>
                <td className="text-xs text-slate-500">{l.description || cpts.find((c) => c.code === l.cpt)?.description}</td>
                <td className="w-28"><input className="input" placeholder="25, 59" value={l.modifiers} onChange={(e) => updateLine(i, { modifiers: e.target.value })} /></td>
                <td className="w-20"><input type="number" min={1} className="input" value={l.units} onChange={(e) => updateLine(i, { units: Number(e.target.value) })} /></td>
                <td className="w-28"><input type="number" step="0.01" min={0} className="input" value={l.charge} onChange={(e) => updateLine(i, { charge: e.target.value })} /></td>
                <td className="w-24"><input className="input" value={l.dxPointers} onChange={(e) => updateLine(i, { dxPointers: e.target.value })} /></td>
                <td>
                  {lines.length > 1 && (
                    <button type="button" className="text-slate-400 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex items-center justify-between">
          <div className="text-sm text-slate-500">Total charges: <span className="font-semibold text-slate-900">${total.toFixed(2)}</span></div>
          <button className="btn btn-primary" disabled={pending}>{pending ? "Creating claim..." : "Save encounter and build claim"}</button>
        </div>
      </div>
    </form>
  );
}
