/**
 * Product mockup for the landing page.
 *
 * Drawn as markup and inline SVG rather than a bitmap screenshot: it stays
 * sharp on any display, adds no binary asset to the repository, and cannot go
 * stale against a rebuild. The figures mirror the seeded demo practice.
 */

import { LogoMark } from "@/components/logo";

const CHARGES = [2.42, 2.55, 2.61, 2.48, 2.72, 2.66, 2.81, 2.74, 2.62, 2.7, 2.58, 2.47];
const COLLECTIONS = [1.52, 1.63, 1.71, 1.6, 1.79, 1.74, 1.86, 1.81, 1.72, 1.78, 1.69, 1.61];

const W = 520;
const H = 132;
const MAX = 3.0;

/** Smooth cubic path through evenly spaced points. */
function curve(values: number[]): { line: string; area: string } {
  const step = W / (values.length - 1);
  const pt = (v: number, i: number) => [i * step, H - (v / MAX) * H] as const;
  const points = values.map(pt);
  let d = `M ${points[0][0]},${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const cx = (x0 + x1) / 2;
    d += ` C ${cx},${y0} ${cx},${y1} ${x1},${y1}`;
  }
  return { line: d, area: `${d} L ${W},${H} L 0,${H} Z` };
}

const chargesPath = curve(CHARGES);
const collectionsPath = curve(COLLECTIONS);

/** Donut segments for payer mix. */
const MIX = [
  { label: "Medicare", pct: 36, color: "#15803d" },
  { label: "Medicaid", pct: 13, color: "#22c55e" },
  { label: "UnitedHealthcare", pct: 12, color: "#4ade80" },
  { label: "Aetna", pct: 10, color: "#14b8a6" },
  { label: "Cigna", pct: 8, color: "#84cc16" },
  { label: "Anthem", pct: 7, color: "#a3e635" },
  { label: "Other", pct: 14, color: "#cbd5e1" },
];

const KPIS = [
  { label: "Charges", value: "$31.4M", tone: "text-slate-900", dot: "bg-slate-300" },
  { label: "Collections", value: "$21.6M", tone: "text-green-700", dot: "bg-green-500" },
  { label: "Days in A/R", value: "23", tone: "text-green-700", dot: "bg-green-500" },
  { label: "Net collection", value: "97.6%", tone: "text-green-700", dot: "bg-green-500" },
];

const NAV = ["My work", "Practice analytics", "Scheduling", "Patients", "Claims", "Remittance", "Denials", "Reports"];

export function AppMockup() {
  let offset = 0;
  const circumference = 2 * Math.PI * 42;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/20 ring-1 ring-slate-900/5">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        <div className="ml-3 flex-1 truncate rounded-md bg-white px-3 py-1 text-[11px] text-slate-400 ring-1 ring-slate-200">
          collaboratmd.app/admin
        </div>
      </div>

      <div className="flex">
        {/* Sidebar */}
        <aside className="hidden w-44 shrink-0 border-r border-slate-200 bg-white py-3 sm:block">
          <div className="mb-3 flex items-center gap-2 px-3">
            <LogoMark className="h-7 w-7" id="cmd-mockup" />
            <span className="text-[11px] font-bold text-slate-800">CollaboratMD</span>
          </div>
          <ul className="space-y-0.5 px-2">
            {NAV.map((item, i) => (
              <li
                key={item}
                className={`rounded-md px-2.5 py-1.5 text-[11px] font-medium ${
                  i === 1 ? "bg-green-50 text-green-700" : "text-slate-500"
                }`}
              >
                {item}
              </li>
            ))}
          </ul>
        </aside>

        {/* Main panel */}
        <div className="min-w-0 flex-1 bg-slate-50 p-4">
          <div className="mb-1 text-sm font-bold text-slate-900">Practice analytics</div>
          <div className="mb-3 text-[10px] text-slate-500">
            Demo data · 100 providers · 15,000 patients · 105,000 claims · trailing 12 months
          </div>

          {/* KPI row */}
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {KPIS.map((k) => (
              <div key={k.label} className="rounded-lg border border-slate-200 bg-white p-2.5">
                <div className="flex items-center gap-1">
                  <span className={`h-1 w-1 rounded-full ${k.dot}`} />
                  <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-500">{k.label}</span>
                </div>
                <div className={`mt-0.5 text-base font-bold leading-none ${k.tone}`}>{k.value}</div>
              </div>
            ))}
          </div>

          <div className="grid gap-2 lg:grid-cols-3">
            {/* Revenue trend */}
            <div className="rounded-lg border border-slate-200 bg-white p-3 lg:col-span-2">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
                Charges, collections and adjustments
              </div>
              <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label="Charges and collections over twelve months">
                <defs>
                  <linearGradient id="mkCharges" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#94a3b8" stopOpacity="0.30" />
                    <stop offset="100%" stopColor="#94a3b8" stopOpacity="0.02" />
                  </linearGradient>
                  <linearGradient id="mkCollections" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16a34a" stopOpacity="0.40" />
                    <stop offset="100%" stopColor="#16a34a" stopOpacity="0.03" />
                  </linearGradient>
                </defs>
                {[0.25, 0.5, 0.75].map((f) => (
                  <line key={f} x1="0" y1={H * f} x2={W} y2={H * f} stroke="#e5e9f0" strokeWidth="1" />
                ))}
                <path d={chargesPath.area} fill="url(#mkCharges)" />
                <path d={chargesPath.line} fill="none" stroke="#94a3b8" strokeWidth="2" />
                <path d={collectionsPath.area} fill="url(#mkCollections)" />
                <path d={collectionsPath.line} fill="none" stroke="#16a34a" strokeWidth="2.5" />
              </svg>
              <div className="mt-1.5 flex gap-3 text-[8px] text-slate-500">
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-slate-400" /> Charges</span>
                <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-green-600" /> Collections</span>
              </div>
            </div>

            {/* Payer mix donut */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Payer mix</div>
              <div className="flex items-center gap-2">
                <svg viewBox="0 0 100 100" className="h-20 w-20 -rotate-90" role="img" aria-label="Share of billed charges by payer">
                  {MIX.map((s) => {
                    const dash = (s.pct / 100) * circumference;
                    const el = (
                      <circle
                        key={s.label}
                        cx="50" cy="50" r="42"
                        fill="none"
                        stroke={s.color}
                        strokeWidth="14"
                        strokeDasharray={`${dash} ${circumference - dash}`}
                        strokeDashoffset={-offset}
                      />
                    );
                    offset += dash;
                    return el;
                  })}
                </svg>
                <ul className="space-y-0.5 text-[8px] text-slate-500">
                  {MIX.slice(0, 5).map((s) => (
                    <li key={s.label} className="flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
                      {s.label}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          {/* Denials strip */}
          <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-2 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Denials recovered by reason code</div>
            <div className="space-y-1.5">
              {[
                { code: "CARC 16", w: "92%", amt: "+$1.2M" },
                { code: "CARC 197", w: "74%", amt: "+$968k" },
                { code: "CARC 27", w: "51%", amt: "+$664k" },
                { code: "CARC 11", w: "38%", amt: "+$497k" },
              ].map((d) => (
                <div key={d.code} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-[8px] font-mono text-slate-500">{d.code}</span>
                  <span className="h-2 rounded-sm bg-green-500" style={{ width: d.w }} />
                  <span className="text-[8px] font-semibold tabular-nums text-green-700">{d.amt}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
