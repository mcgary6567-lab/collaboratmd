"use client";

import { NDC_UNITS, isDrugCode } from "@/lib/codes/ndc";
import { TIMED_THERAPY_CODES, eightMinuteRule, isAnesthesiaCode } from "@/lib/time-units";
import { Fragment, useActionState, useState } from "react";
import { Trash, Plus } from "lucide-react";
import { createEncounterAction } from "@/app/(app)/actions";
import { Field, Alert } from "@/components/ui";
import { PosOptions } from "@/components/code-pickers";
import { CodeList, useCodeSearch } from "@/components/code-search";
import { US_STATES } from "@/lib/us";
import { NpiLookup } from "@/components/npi-lookup";
import { money } from "@/lib/utils";
import { PatientPicker, type PatientOption } from "@/components/patient-picker";

type Line = { cpt: string; modifiers: string; units: number; charge: string; dxPointers: string; description: string; minutes?: string; ndc?: string; ndcUnit?: string; ndcQuantity?: string };


export function ChargeEntryForm({
  defaults,
  initialPatient,
  providers,
  locations = [],
  cpts,
  icds,
}: {
  defaults: { providerId?: string; appointmentId?: string; dos: string; locationId?: string | null };
  locations?: { id: string; name: string; placeOfService: string }[];
  initialPatient: PatientOption | null;
  providers: { id: string; name: string }[];
  cpts: { code: string; description: string; fee: number }[];
  icds: { code: string; description: string }[];
}) {
  const [state, action, pending] = useActionState(createEncounterAction, undefined);
  const [patientId, setPatientId] = useState(initialPatient?.id ?? "");
  const [providerId, setProviderId] = useState(defaults.providerId ?? providers[0]?.id ?? "");
  const [dos, setDos] = useState(defaults.dos);
  const [locationId, setLocationId] = useState(defaults.locationId ?? "");
  const [pos, setPos] = useState(locations.find((l) => l.id === defaults.locationId)?.placeOfService ?? "11");
  const [dx, setDx] = useState<string[]>([""]);
  const dxSearch = useCodeSearch("dx", icds);
  const pxSearch = useCodeSearch("px", cpts);
  const [referring, setReferring] = useState({ lastName: "", firstName: "", npi: "" });
  const [supervisingId, setSupervisingId] = useState("");
  const [shared, setShared] = useState({ withId: "", attested: false, teaching: false });
  const [accident, setAccident] = useState({ employment: false, auto: false, autoState: "", other: false, date: "", claimNumber: "", employer: "" });
  const setAcc = (patch: Partial<typeof accident>) => setAccident((a) => ({ ...a, ...patch }));
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
    locationId: locationId || null,
    diagnoses: dx.map((d) => d.trim()).filter(Boolean),
    referring: referring.npi.trim() || referring.lastName.trim() ? referring : null,
    supervisingProviderId: supervisingId && supervisingId !== providerId ? supervisingId : null,
    sharedWithProviderId: shared.withId && shared.withId !== providerId ? shared.withId : null,
    substantiveAttested: shared.attested,
    teachingPresent: shared.teaching,
    accident: accident.employment || accident.auto || accident.other || accident.claimNumber.trim() ? accident : null,
    lines: lines
      .filter((l) => l.cpt.trim())
      .map((l) => ({
        cpt: l.cpt.trim(),
        modifiers: l.modifiers.split(",").map((m) => m.trim()).filter(Boolean),
        units: Number(l.units) || 1,
        minutes: Number(l.minutes) || null,
        ndc: isDrugCode(l.cpt) ? l.ndc || null : null,
        ndcUnit: isDrugCode(l.cpt) ? l.ndcUnit || "UN" : null,
        ndcQuantity: isDrugCode(l.cpt) ? Number(l.ndcQuantity) || null : null,
        chargeCents: Math.round((parseFloat(l.charge) || 0) * 100),
        dxPointers: l.dxPointers.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => !Number.isNaN(n)),
        description: l.description || pxSearch.describe(l.cpt),
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
        {locations.length > 0 && (
          <Field label="Location">
            <select className="select" value={locationId} onChange={(e) => { setLocationId(e.target.value); const l = locations.find((x) => x.id === e.target.value); if (l) setPos(l.placeOfService); }}>
              <option value="">Main office (billing address)</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        )}
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
            <PosOptions />
          </select>
        </Field>
        <details className="sm:col-span-2 lg:col-span-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300">Referring provider (when the payer requires a referral)</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            <Field label="Last name"><input className="input" value={referring.lastName} onChange={(e) => setReferring((r) => ({ ...r, lastName: e.target.value }))} autoComplete="off" /></Field>
            <Field label="First name"><input className="input" value={referring.firstName} onChange={(e) => setReferring((r) => ({ ...r, firstName: e.target.value }))} autoComplete="off" /></Field>
            <Field label="NPI"><input className="input font-mono" value={referring.npi} onChange={(e) => setReferring((r) => ({ ...r, npi: e.target.value }))} inputMode="numeric" maxLength={10} placeholder="10 digits" autoComplete="off" /></Field>
            <div className="sm:col-span-3"><NpiLookup npi={referring.npi} onFound={(r) => setReferring((x) => ({ ...x, lastName: r.lastName ?? r.name, firstName: r.firstName ?? "" }))} /></div>
          </div>
        </details>
        <details className="sm:col-span-2 lg:col-span-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300">Supervising provider (a physician supervised this service)</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Supervising provider">
              <select className="select" value={supervisingId} onChange={(e) => setSupervisingId(e.target.value)}>
                <option value="">None</option>
                {providers.filter((p) => p.id !== providerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <p className="self-end text-xs text-slate-500 dark:text-slate-400">Sent as the supervising provider (loop 2310D, box 17 DQ). Some payers require it for services by residents, therapists or providers not yet credentialed with them.</p>
          </div>
        </details>
        <details className="sm:col-span-2 lg:col-span-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300">Split/shared visit or teaching setting</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <Field label="Visit shared with (hospital or nursing facility)">
              <select className="select" value={shared.withId} onChange={(e) => setShared((x) => ({ ...x, withId: e.target.value }))}>
                <option value="">Not shared</option>
                {providers.filter((p) => p.id !== providerId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <label className="flex items-start gap-2 self-end text-sm">
              <input type="checkbox" className="mt-1" checked={shared.attested} disabled={!shared.withId} onChange={(e) => setShared((x) => ({ ...x, attested: e.target.checked }))} />
              <span>The billing practitioner performed the substantive portion (more than half the time, or the substantive part of decision making). FS is added.</span>
            </label>
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" className="mt-1" checked={shared.teaching} onChange={(e) => setShared((x) => ({ ...x, teaching: e.target.checked }))} />
              <span>Teaching setting: the teaching physician was present for the key or critical portion (add GC to the lines).</span>
            </label>
          </div>
        </details>
        <details className="sm:col-span-2 lg:col-span-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600 dark:text-slate-300">Injury, accident or workers&apos; comp</summary>
          <fieldset className="mt-3 space-y-3">
            <legend className="sr-only">Is the condition related to</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={accident.employment} onChange={(e) => setAcc({ employment: e.target.checked })} /> Related to employment (workers&apos; comp)</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={accident.auto} onChange={(e) => setAcc({ auto: e.target.checked })} /> Auto accident</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={accident.other} onChange={(e) => setAcc({ other: e.target.checked })} /> Other accident</label>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Date of accident or injury"><input type="date" className="input" value={accident.date} onChange={(e) => setAcc({ date: e.target.value })} /></Field>
              {accident.auto && (
                <Field label="State of the auto accident">
                  <select className="select" value={accident.autoState} onChange={(e) => setAcc({ autoState: e.target.value })}>
                    <option value="">Choose...</option>
                    {US_STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Insurer's claim number (box 11b)"><input className="input" value={accident.claimNumber} onChange={(e) => setAcc({ claimNumber: e.target.value })} autoComplete="off" /></Field>
              {accident.employment && <Field label="Employer"><input className="input" value={accident.employer} onChange={(e) => setAcc({ employer: e.target.value })} autoComplete="off" /></Field>}
            </div>
          </fieldset>
        </details>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Diagnoses (ICD-10-CM)</h2>
          <button type="button" className="btn btn-secondary text-xs" onClick={() => setDx((d) => [...d, ""])} disabled={dx.length >= 12}>
            <Plus className="h-3.5 w-3.5" /> Add diagnosis
          </button>
        </div>
        <CodeList id="icd-list" options={dxSearch.options} />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {dx.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-xs font-semibold text-slate-500">{i + 1}</span>
              <input list="icd-list" className="input font-mono" placeholder="e.g. E11.9" value={d} onChange={(e) => { dxSearch.search(e.target.value); setDx((arr) => arr.map((x, j) => (j === i ? e.target.value.toUpperCase() : x))); }} />
              <span className="hidden min-w-0 flex-1 truncate text-xs text-slate-500 lg:inline">{dxSearch.describe(d)}</span>
              {dx.length > 1 && (
                <button type="button" className="text-slate-500 hover:text-red-600" onClick={() => setDx((arr) => arr.filter((_, j) => j !== i))}>
                  <Trash className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Service lines (CPT / HCPCS)</h2>
          {lines.some((l) => TIMED_THERAPY_CODES.has(l.cpt)) && (
            <button type="button" className="btn btn-secondary ml-auto mr-2 text-xs" title="Medicare's 8-minute rule: total timed minutes decide the units" onClick={() => {
              const units = eightMinuteRule(lines.map((l) => ({ code: l.cpt, minutes: Number(l.minutes) || 0 })));
              setLines((ls) => ls.map((l) => (units.has(l.cpt) ? { ...l, units: Math.max(units.get(l.cpt)!, 1) } : l)));
            }}>Units from minutes</button>
          )}
          <button type="button" className="btn btn-secondary text-xs" onClick={() => setLines((ls) => [...ls, { cpt: "", modifiers: "", units: 1, charge: "", dxPointers: "1", description: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </button>
        </div>
        <CodeList id="cpt-list" options={pxSearch.options} />
        <div tabIndex={0} role="region" aria-label="Table (scrolls sideways)" className="overflow-x-auto"><table className="table">
          <thead>
            <tr><th>#</th><th>CPT</th><th>Description</th><th>Modifiers</th><th>Units</th><th>Minutes</th><th>Charge ($)</th><th>Dx ptr</th><th></th></tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <Fragment key={i}>
              <tr>
                <td className="text-slate-500">{i + 1}</td>
                <td className="w-32">
                  <input list="cpt-list" className="input font-mono" aria-label={`Line ${i + 1} CPT`} value={l.cpt} onChange={(e) => {
                    const code = e.target.value.toUpperCase();
                    pxSearch.search(code);
                    const fee = feeFor(code);
                    updateLine(i, { cpt: code, charge: fee !== undefined ? (fee / 100).toFixed(2) : l.charge });
                  }} />
                </td>
                <td className="text-xs text-slate-500">{l.description || pxSearch.describe(l.cpt)}</td>
                <td className="w-28"><input className="input" placeholder="25, 59" value={l.modifiers} aria-label={`Line ${i + 1} modifiers`} onChange={(e) => updateLine(i, { modifiers: e.target.value })} /></td>
                <td className="w-20"><input type="number" min={1} className="input" value={l.units} aria-label={`Line ${i + 1} units`} onChange={(e) => updateLine(i, { units: Number(e.target.value) })} /></td>
                <td className="w-20">{TIMED_THERAPY_CODES.has(l.cpt) || isAnesthesiaCode(l.cpt) ? <input type="number" min={0} max={1440} className="input" value={l.minutes ?? ""} aria-label={`Line ${i + 1} minutes`} onChange={(e) => updateLine(i, { minutes: e.target.value })} /> : <span className="text-xs text-slate-500">-</span>}</td>
                <td className="w-28"><input type="number" step="0.01" min={0} className="input" value={l.charge} aria-label={`Line ${i + 1} charge`} onChange={(e) => updateLine(i, { charge: e.target.value })} /></td>
                <td className="w-24"><input className="input" value={l.dxPointers} aria-label={`Line ${i + 1} diagnosis pointers`} onChange={(e) => updateLine(i, { dxPointers: e.target.value })} /></td>
                <td>
                  {lines.length > 1 && (
                    <button type="button" className="text-slate-500 hover:text-red-600" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
                      <Trash className="h-4 w-4" />
                    </button>
                  )}
                </td>
              </tr>
              {isDrugCode(l.cpt) && (
                <tr>
                  <td />
                  <td colSpan={8}>
                    <div className="flex flex-wrap items-end gap-3 text-sm">
                      <label className="block"><span className="label">NDC (from the package)</span><input className="input w-40 font-mono" value={l.ndc ?? ""} placeholder="12345-6789-01" aria-label={`Line ${i + 1} NDC`} onChange={(e) => updateLine(i, { ndc: e.target.value })} /></label>
                      <label className="block"><span className="label">Quantity</span><input type="number" min={0} step="0.001" className="input w-24" value={l.ndcQuantity ?? ""} aria-label={`Line ${i + 1} drug quantity`} onChange={(e) => updateLine(i, { ndcQuantity: e.target.value })} /></label>
                      <label className="block"><span className="label">Unit</span><select className="select w-44" value={l.ndcUnit ?? "UN"} aria-label={`Line ${i + 1} drug unit`} onChange={(e) => updateLine(i, { ndcUnit: e.target.value })}>{NDC_UNITS.map(([u, n]) => <option key={u} value={u}>{u}: {n}</option>)}</select></label>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table></div>
        <div className="mt-3 flex items-center justify-between">
          <div className="text-sm text-slate-500">Total charges: <span className="font-semibold text-slate-900">{money(Math.round(total * 100))}</span></div>
          <button className="btn btn-primary" disabled={pending}>{pending ? "Creating claim..." : "Save encounter and build claim"}</button>
        </div>
      </div>
    </form>
  );
}
