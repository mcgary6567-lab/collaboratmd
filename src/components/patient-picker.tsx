"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";

export interface PatientOption {
  id: string;
  label: string;
  mrn: string;
  dob: string;
}

/**
 * Type-ahead patient selector.
 *
 * Queries the server as you type rather than embedding the roster, which at
 * practice scale would be tens of thousands of options.
 */
export function PatientPicker({
  name,
  initial,
  onSelect,
}: {
  name?: string;
  initial?: PatientOption | null;
  onSelect?: (p: PatientOption | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PatientOption[]>([]);
  const [selected, setSelected] = useState<PatientOption | null>(initial ?? null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selected) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/patients/search?q=${encodeURIComponent(query)}`);
        setResults(res.ok ? await res.json() : []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => clearTimeout(handle);
  }, [query, selected]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const choose = (p: PatientOption | null) => {
    setSelected(p);
    setOpen(false);
    setQuery("");
    onSelect?.(p);
  };

  return (
    <div className="relative" ref={boxRef}>
      {name && <input type="hidden" name={name} value={selected?.id ?? ""} />}
      {selected ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
          <span className="font-medium">{selected.label}</span>
          <span className="font-mono text-xs text-slate-400">{selected.mrn}</span>
          <button type="button" className="ml-auto text-slate-400 hover:text-red-600" onClick={() => choose(null)} aria-label="Clear patient">
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="input pl-8"
              placeholder="Search name or MRN"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setOpen(true)}
              autoComplete="off"
            />
          </div>
          {open && (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
              {loading && <li className="px-3 py-2 text-sm text-slate-400">Searching...</li>}
              {!loading && results.length === 0 && <li className="px-3 py-2 text-sm text-slate-400">No matches</li>}
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                    onClick={() => choose(p)}
                  >
                    <span className="font-medium">{p.label}</span>
                    <span className="font-mono text-xs text-slate-400">{p.mrn}</span>
                    <span className="ml-auto text-xs text-slate-400">{p.dob}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
