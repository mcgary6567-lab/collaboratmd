"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, ComposedChart,
  Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

const GRID = "#e5e9f0";
const AXIS = { tickLine: false, axisLine: false, fontSize: 12, stroke: "#64748b" } as const;

const compact = (v: number) =>
  v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `$${Math.round(v / 1_000)}k` : `$${Math.round(v)}`;
const full = (v: number) => "$" + Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Charges against collections, with adjustments as a trailing line. */
export function RevenueTrend({ data }: { data: { month: string; charges: number; payments: number; adjustments: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="gCharges" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#94a3b8" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#94a3b8" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="gPayments" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#2563eb" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="month" {...AXIS} />
        <YAxis tickFormatter={compact} width={62} {...AXIS} />
        <Tooltip formatter={(v, name) => [full(Number(v)), String(name)]} />
        <Legend iconType="circle" />
        <Area type="monotone" dataKey="charges" name="Charges" stroke="#94a3b8" strokeWidth={2} fill="url(#gCharges)" />
        <Area type="monotone" dataKey="payments" name="Collections" stroke="#2563eb" strokeWidth={2} fill="url(#gPayments)" />
        <Line type="monotone" dataKey="adjustments" name="Adjustments" stroke="#f59e0b" strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

const AGE_COLORS = ["#60a5fa", "#3b82f6", "#f59e0b", "#f97316", "#dc2626"];

export function AgingChart({ aging }: { aging: { b0_30: number; b31_60: number; b61_90: number; b91_120: number; b120p: number } }) {
  const data = [
    { bucket: "0-30", value: aging.b0_30 / 100 },
    { bucket: "31-60", value: aging.b31_60 / 100 },
    { bucket: "61-90", value: aging.b61_90 / 100 },
    { bucket: "91-120", value: aging.b91_120 / 100 },
    { bucket: "120+", value: aging.b120p / 100 },
  ];
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
        <XAxis dataKey="bucket" {...AXIS} />
        <YAxis tickFormatter={compact} width={62} {...AXIS} />
        <Tooltip formatter={(v) => full(Number(v))} />
        <Bar dataKey="value" name="Insurance AR" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => <Cell key={i} fill={AGE_COLORS[i]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal ranking of denial reasons by dollars at risk. */
export function DenialReasonChart({ data }: { data: { carc: string; category: string; amountCents: number; count: number }[] }) {
  const rows = data.map((d) => ({
    label: `CARC ${d.carc}`,
    value: d.amountCents / 100,
    count: d.count,
    category: d.category.replace(/_/g, " "),
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID} horizontal={false} />
        <XAxis type="number" tickFormatter={compact} {...AXIS} />
        <YAxis type="category" dataKey="label" width={78} {...AXIS} />
        <Tooltip formatter={(v, _n, p) => [`${full(Number(v))} · ${p.payload.count} claims · ${p.payload.category}`, "At risk"]} />
        <Bar dataKey="value" fill="#e11d48" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const MIX_COLORS = ["#2563eb", "#0ea5e9", "#14b8a6", "#22c55e", "#84cc16", "#eab308", "#f59e0b", "#f97316", "#ef4444", "#ec4899", "#a855f7", "#6366f1"];

/** Share of billed charges by payer. */
export function PayerMixChart({ data }: { data: { payer: string; billedCents: number }[] }) {
  const rows = data.filter((d) => d.billedCents > 0).map((d) => ({ name: d.payer, value: d.billedCents / 100 }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius={62} outerRadius={104} paddingAngle={2}>
          {rows.map((_, i) => <Cell key={i} fill={MIX_COLORS[i % MIX_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v, n) => [full(Number(v)), String(n)]} />
        <Legend layout="vertical" align="right" verticalAlign="middle" iconType="circle" wrapperStyle={{ fontSize: 11, lineHeight: "16px" }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

/** Small inline bar used inside table rows. */
export function MiniBar({ value, max, tone = "#2563eb" }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.max((value / max) * 100, 1) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-100">
      <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, background: tone }} />
    </div>
  );
}
