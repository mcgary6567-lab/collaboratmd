"use client";

import { useActionState, useMemo, useState } from "react";
import { emLevel, MDM_ELEMENTS, MDM_LEVELS, type MdmLevel, type PatientKind } from "@/lib/coding/em";
import { suggestDiagnoses } from "@/lib/coding/dx";
import { codeNoteAction, type NoteCodingState } from "./actions";

type Code = { code: string; description: string };

export function EmCalculator({ cpts }: { cpts: Code[] }) {
  const [kind, setKind] = useState<PatientKind>("established");
  const [minutes, setMinutes] = useState("");
  const [useMdm, setUseMdm] = useState(true);
  const [mdm, setMdm] = useState<{ problems: MdmLevel; data: MdmLevel; risk: MdmLevel }>({ problems: "low", data: "straightforward", risk: "low" });
  const r = emLevel({ kind, minutes: minutes ? Number(minutes) : null, mdm: useMdm ? mdm : null });
  const describe = (code: string | null) => (code ? cpts.find((c) => c.code === code)?.description ?? "" : "");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="label">Patient</span>
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value as PatientKind)}>
            <option value="established">Established (seen by this group in the last 3 years)</option>
            <option value="new">New</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="label">Total time on the date of the visit (minutes)</span>
          <input className="input" type="number" min={0} max={600} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Optional" />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={useMdm} onChange={(e) => setUseMdm(e.target.checked)} /> Also level by medical decision making
      </label>
      {useMdm && (
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(MDM_ELEMENTS) as (keyof typeof MDM_ELEMENTS)[]).map((k) => (
            <label key={k} className="block text-sm">
              <span className="label">{MDM_ELEMENTS[k].label}</span>
              <select className="input" value={mdm[k]} onChange={(e) => setMdm({ ...mdm, [k]: e.target.value as MdmLevel })}>
                {MDM_LEVELS.map((l) => <option key={l} value={l}>{l}: {MDM_ELEMENTS[k].options[l]}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-4" aria-live="polite">
        {r.code ? (
          <>
            <p className="text-lg font-bold text-slate-900">{r.code}{r.prolongedUnits ? ` + 99417 x${r.prolongedUnits}` : ""}</p>
            <p className="text-sm text-slate-700">{describe(r.code)}</p>
            <p className="mt-1 text-xs text-slate-600">
              By time: {r.byTime ?? "n/a"} · By MDM: {r.byMdm ? `${r.byMdm} (${r.mdmLevel})` : "n/a"} · Using {r.basis === "time" ? "time" : "MDM"}, the higher of the two.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600">Enter the visit time or the MDM elements.</p>
        )}
        {r.notes.map((n) => <p key={n} className="mt-1 text-xs text-slate-600">{n}</p>)}
      </div>
    </div>
  );
}

export function DiagnosisFinder({ icds }: { icds: Code[] }) {
  const [q, setQ] = useState("");
  const hits = useMemo(() => suggestDiagnoses(q, icds), [q, icds]);
  const [copied, setCopied] = useState<string | null>(null);
  return (
    <div>
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. high blood pressure, sugar, low back pain, UTI" aria-label="Describe the diagnosis" />
      <ul className="mt-3 divide-y divide-slate-100">
        {hits.map((h) => (
          <li key={h.code} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span><span className="font-mono font-semibold">{h.code}</span> <span className="text-slate-700">{h.description}</span></span>
            <button type="button" className="btn btn-secondary text-xs" onClick={() => { navigator.clipboard?.writeText(h.code); setCopied(h.code); }}>
              {copied === h.code ? "Copied" : "Copy"}
            </button>
          </li>
        ))}
        {q && !hits.length && <li className="py-2 text-sm text-slate-500">No codes in this practice&apos;s list match. Try another word.</li>}
      </ul>
    </div>
  );
}

export function NoteCoder({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState<NoteCodingState, FormData>(codeNoteAction, { ok: true });
  if (!enabled) {
    return (
      <p className="text-sm text-slate-600">
        Off. A visit note contains patient information, so it is only sent to an AI model when the deployment sets <code>ANTHROPIC_API_KEY</code> and{" "}
        <code>AI_PHI_ALLOWED=1</code>, which should be done only once a business associate agreement with the model provider is in place.
      </p>
    );
  }
  return (
    <form action={action} className="space-y-3">
      <textarea name="note" rows={10} className="input text-sm" placeholder="Paste the visit note" required />
      <button className="btn btn-primary" disabled={pending}>{pending ? "Reading the note..." : "Suggest codes"}</button>
      {state.message && <p className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
      {state.result && (
        <div className="space-y-3 text-sm">
          <div>
            <p className="label">Procedures</p>
            {state.result.cpts.length ? state.result.cpts.map((c) => <p key={c.code}><span className="font-mono font-semibold">{c.code}</span> {c.why}</p>) : <p className="text-slate-500">None suggested.</p>}
          </div>
          <div>
            <p className="label">Diagnoses</p>
            {state.result.diagnoses.length ? state.result.diagnoses.map((c) => <p key={c.code}><span className="font-mono font-semibold">{c.code}</span> {c.why}</p>) : <p className="text-slate-500">None suggested.</p>}
          </div>
          {state.result.gaps.length > 0 && (
            <div>
              <p className="label">Documentation gaps</p>
              <ul className="list-disc pl-5 text-amber-800">{state.result.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          )}
          <p className="text-xs text-slate-500">Suggestions only. The provider and coder decide what is billed.</p>
        </div>
      )}
    </form>
  );
}
