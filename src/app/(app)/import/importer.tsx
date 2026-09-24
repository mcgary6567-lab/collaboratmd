"use client";

import { useState, useTransition } from "react";
import { Sparkles, Upload } from "lucide-react";
import { aiMapAction, previewImportAction, runImportAction, type ImportResult, type PreviewResult } from "@/app/(app)/integration-actions";
import type { Mapping, PatientField } from "@/lib/import/patients";

type Field = { key: PatientField; label: string };

export function Importer({ fields, maxRows }: { fields: Field[]; maxRows: number }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [prev, setPrev] = useState<Extract<PreviewResult, { ok: true }> | null>(null);
  const [mapping, setMapping] = useState<Mapping>({});
  const [mappedBy, setMappedBy] = useState<"rules" | "ai" | "user">("rules");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  const apply = (r: PreviewResult, by: "rules" | "ai" | "user") => {
    if (!r.ok) return setError(r.message);
    setError("");
    setPrev(r);
    setMapping(r.preview.mapping);
    setMappedBy(by);
  };

  const onFile = async (f: File | undefined) => {
    setResult(null);
    setPrev(null);
    if (!f) return;
    if (f.size > 3_900_000) return setError("That file is larger than 3.9 MB. Split it into smaller files.");
    const text = await f.text();
    setFile({ name: f.name, text });
    start(async () => apply(await previewImportAction(text), "rules"));
  };

  const remap = (field: PatientField, col: string) => {
    const next = { ...mapping, [field]: col === "" ? null : Number(col) };
    setMapping(next);
    start(async () => apply(await previewImportAction(file!.text, next), "user"));
  };

  const p = prev?.preview;
  const okRows = p?.sample.filter((s) => s.ok).length ?? 0;

  return (
    <div className="space-y-6">
      <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white p-8 text-center hover:border-brand-500">
        <Upload className="h-6 w-6 text-slate-400" />
        <span className="text-sm font-medium">{file ? file.name : "Choose a CSV file exported from your EHR or practice management system"}</span>
        <span className="text-xs text-slate-500">Comma, semicolon, tab or pipe separated, up to {maxRows.toLocaleString()} rows. Save Excel files as CSV first.</span>
        <input type="file" accept=".csv,.txt,.tsv,text/csv" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {error && <p className="text-sm font-medium text-red-700">{error}</p>}
      {pending && !p && <p className="text-sm text-slate-500">Reading the file...</p>}

      {p && file && (
        <>
          <div className="card p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-semibold">Match the columns</h2>
                <p className="text-xs text-slate-500">
                  {p.rowCount.toLocaleString()} rows · mapped {mappedBy === "ai" ? "with AI from column names and value types (no patient data was sent)" : mappedBy === "user" ? "by you" : "automatically"}. Check each choice.
                </p>
              </div>
              {prev.aiAvailable && (
                <button type="button" className="btn btn-secondary text-xs" disabled={pending} onClick={() => start(async () => apply(await aiMapAction(file.text), "ai"))}>
                  <Sparkles className="h-3.5 w-3.5" /> Suggest with AI
                </button>
              )}
            </div>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {fields.map((f) => {
                const col = mapping[f.key];
                const conf = p.confidence[f.key];
                return (
                  <label key={f.key} className="flex items-center gap-2 text-sm">
                    <span className="w-44 shrink-0 text-slate-700">{f.label}{f.key === "dob" && <span className="text-red-600"> *</span>}</span>
                    <select className="input py-1 text-xs" value={col ?? ""} onChange={(e) => remap(f.key, e.target.value)} disabled={pending}>
                      <option value="">Not in this file</option>
                      {p.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                    {col !== null && col !== undefined && mappedBy === "rules" && conf !== undefined && conf < 0.7 && <span className="text-[10px] text-amber-700">check</span>}
                  </label>
                );
              })}
            </div>
            {p.unmapped.length > 0 && <p className="mt-3 text-xs text-slate-500">Not imported: {p.unmapped.join(", ")}</p>}
          </div>

          <div className="card p-5">
            <h2 className="mb-2 font-semibold">First rows as they will be imported</h2>
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Row</th><th>Patient</th><th>DOB</th><th>Sex</th><th>Contact</th><th>Insurance</th></tr></thead>
                <tbody>
                  {p.sample.map((s, i) => (
                    <tr key={i}>
                      <td>{i + 2}</td>
                      {s.ok ? (
                        <>
                          <td>{s.value.lastName}, {s.value.firstName}{s.value.mrn && <span className="ml-1 font-mono text-xs text-slate-500">{s.value.mrn}</span>}</td>
                          <td>{s.value.dob}</td>
                          <td>{s.value.sex}</td>
                          <td className="text-xs">{[s.value.phone, s.value.email, [s.value.city, s.value.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</td>
                          <td className="text-xs">{s.value.payerName ? `${s.value.payerName} ${s.value.memberId}` : ""}</td>
                        </>
                      ) : (
                        <td colSpan={5} className="text-red-700">Will be skipped: {s.error}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                className="btn btn-primary"
                disabled={pending || mapping.dob === null || mapping.dob === undefined || okRows === 0}
                onClick={() => start(async () => setResult(await runImportAction(file.name, file.text, mapping, mappedBy)))}
              >
                {pending ? "Importing..." : `Import ${p.rowCount.toLocaleString()} rows`}
              </button>
              <span className="text-xs text-slate-500">Existing patients are matched by MRN, or by name and date of birth, and updated; blank cells never erase data.</span>
            </div>
          </div>
        </>
      )}

      {result && (
        <div className={`card p-5 ${result.ok ? "" : "border-red-200"}`}>
          {result.ok ? (
            <>
              <h2 className="font-semibold">Import finished</h2>
              <p className="text-sm">{result.created} created, {result.updated} updated, {result.skipped} skipped of {result.total} rows.</p>
              {result.issues.length > 0 && (
                <ul className="mt-2 max-h-64 space-y-0.5 overflow-auto text-xs">
                  {result.issues.map((x, i) => <li key={i}><span className="font-mono">Row {x.row}</span>: {x.message}</li>)}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-red-700">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
