"use client";

import { TIMED_THERAPY_CODES, isAnesthesiaCode } from "@/lib/time-units";
import { useActionState, useState } from "react";
import { Plus, Trash } from "lucide-react";
import { editClaimAction } from "@/app/(app)/claim-edit-actions";
import { Alert, Field } from "@/components/ui";
import { PosOptions } from "@/components/code-pickers";
import { CodeList, useCodeSearch } from "@/components/code-search";
import { money } from "@/lib/utils";

type Line = { cpt: string; modifiers: string; units: number; charge: string; dxPointers: string; description: string; minutes?: string };


export function ClaimEditForm({
  claimId,
  initial,
  cpts,
  icds,
}: {
  claimId: string;
  initial: { dateOfService: string; placeOfService: string; diagnoses: string[]; lines: { cpt: string; modifiers: string[]; units: number; chargeCents: number; dxPointers: number[]; description: string | null; minutes?: number | null }[] };
  cpts: { code: string; description: string; fee: number }[];
  icds: { code: string; description: string }[];
}) {
  const [state, action, pending] = useActionState(editClaimAction.bind(null, claimId), undefined);
  const [dos, setDos] = useState(initial.dateOfService);
  const [pos, setPos] = useState(initial.placeOfService);
  const dxSearch = useCodeSearch("dx", icds);
  const pxSearch = useCodeSearch("px", cpts);
  const [dx, setDx] = useState<string[]>(initial.diagnoses.length ? initial.diagnoses : [""]);
  const [lines, setLines] = useState<Line[]>(
    initial.lines.map((l) => ({ cpt: l.cpt, modifiers: l.modifiers.join(", "), units: l.units, charge: (l.chargeCents / 100).toFixed(2), dxPointers: l.dxPointers.join(","), description: l.description ?? "", minutes: l.minutes ? String(l.minutes) : "" })),
  );
  const update = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((a, l) => a + (parseFloat(l.charge) || 0) * (l.units || 1), 0);
  const payload = JSON.stringify({
    dateOfService: dos,
    placeOfService: pos,
    diagnoses: dx.map((d) => d.trim()).filter(Boolean),
    lines: lines.filter((l) => l.cpt.trim()).map((l) => ({
      cpt: l.cpt.trim(),
      modifiers: l.modifiers.split(",").map((m) => m.trim()).filter(Boolean),
      units: Number(l.units) || 1,
      minutes: Number(l.minutes) || null,
      chargeCents: Math.round((parseFloat(l.charge) || 0) * 100),
      dxPointers: l.dxPointers.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => !Number.isNaN(n)),
      description: l.description || pxSearch.describe(l.cpt),
    })),
  });

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="payload" value={payload} />
      {state && !state.ok && <Alert kind="error">{state.message}</Alert>}
      <div className="card grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Date of service"><input type="date" className="input" value={dos} onChange={(e) => setDos(e.target.value)} /></Field>
        <Field label="Place of service">
          <select className="select" value={pos} onChange={(e) => setPos(e.target.value)}>
            <PosOptions />
          </select>
        </Field>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Diagnoses (ICD-10-CM)</h2>
          <button type="button" className="btn btn-secondary text-xs" onClick={() => setDx((d) => [...d, ""])} disabled={dx.length >= 12}><Plus className="h-3.5 w-3.5" /> Add</button>
        </div>
        <CodeList id="icd-edit" options={dxSearch.options} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dx.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-xs font-semibold text-slate-500">{i + 1}</span>
              <input list="icd-edit" className="input font-mono" value={d} onChange={(e) => { dxSearch.search(e.target.value); setDx((a) => a.map((x, j) => (j === i ? e.target.value.toUpperCase() : x))); }} />
              {dx.length > 1 && <button type="button" aria-label="Remove diagnosis" className="text-slate-500 hover:text-red-600" onClick={() => setDx((a) => a.filter((_, j) => j !== i))}><Trash className="h-4 w-4" /></button>}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Service lines</h2>
          <button type="button" className="btn btn-secondary text-xs" onClick={() => setLines((ls) => [...ls, { cpt: "", modifiers: "", units: 1, charge: "", dxPointers: "1", description: "" }])}><Plus className="h-3.5 w-3.5" /> Add line</button>
        </div>
        <CodeList id="cpt-edit" options={pxSearch.options} />
        <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>#</th><th>CPT</th><th>Modifiers</th><th>Units</th><th>Minutes</th><th>Charge ($)</th><th>Dx ptr</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="text-slate-500">{i + 1}</td>
                  <td className="w-32">
                    <input list="cpt-edit" className="input font-mono" value={l.cpt} onChange={(e) => {
                      const code = e.target.value.toUpperCase();
                      pxSearch.search(code);
                      const fee = cpts.find((c) => c.code === code)?.fee;
                      update(i, { cpt: code, charge: fee !== undefined ? (fee / 100).toFixed(2) : l.charge, description: pxSearch.describe(code) ?? "" });
                    }} />
                  </td>
                  <td className="w-28"><input className="input" value={l.modifiers} onChange={(e) => update(i, { modifiers: e.target.value })} /></td>
                  <td className="w-20"><input type="number" min={1} className="input" value={l.units} onChange={(e) => update(i, { units: Number(e.target.value) })} /></td>
                  <td className="w-20">{TIMED_THERAPY_CODES.has(l.cpt) || isAnesthesiaCode(l.cpt) ? <input type="number" min={0} max={1440} className="input" value={l.minutes ?? ""} aria-label={`Line ${i + 1} minutes`} onChange={(e) => update(i, { minutes: e.target.value })} /> : <span className="text-xs text-slate-500">-</span>}</td>
                  <td className="w-28"><input type="number" step="0.01" min={0} className="input" value={l.charge} onChange={(e) => update(i, { charge: e.target.value })} /></td>
                  <td className="w-24"><input className="input" value={l.dxPointers} onChange={(e) => update(i, { dxPointers: e.target.value })} /></td>
                  <td>{lines.length > 1 && <button type="button" aria-label="Remove line" className="text-slate-500 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash className="h-4 w-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm text-slate-500">Total: <span className="font-semibold text-slate-900">{money(Math.round(total * 100))}</span></div>
          <div className="flex gap-2">
            <a href={`/claims/${claimId}`} className="btn btn-secondary">Cancel</a>
            <button className="btn btn-primary" disabled={pending}>{pending ? "Saving..." : "Save and re-scrub"}</button>
          </div>
        </div>
      </div>
    </form>
  );
}
