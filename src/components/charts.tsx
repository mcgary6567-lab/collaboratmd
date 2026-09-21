"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";

const fmt = (v: number) => "$" + v.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function TrendChart({ data }: { data: { month: string; charges: number; payments: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" vertical={false} />
        <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} fontSize={12} width={64} />
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <Legend iconType="circle" />
        <Bar dataKey="charges" name="Charges" fill="#94a3b8" radius={[4, 4, 0, 0]} />
        <Bar dataKey="payments" name="Payments" fill="#2563eb" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AgingChart({ aging }: { aging: { b0_30: number; b31_60: number; b61_90: number; b91_120: number; b120p: number } }) {
  const data = [
    { bucket: "0-30", value: aging.b0_30 / 100 },
    { bucket: "31-60", value: aging.b31_60 / 100 },
    { bucket: "61-90", value: aging.b61_90 / 100 },
    { bucket: "91-120", value: aging.b91_120 / 100 },
    { bucket: "120+", value: aging.b120p / 100 },
  ];
  const colors = ["#60a5fa", "#3b82f6", "#f59e0b", "#f97316", "#dc2626"];
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e9f0" vertical={false} />
        <XAxis dataKey="bucket" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis tickFormatter={fmt} tickLine={false} axisLine={false} fontSize={12} width={64} />
        <Tooltip formatter={(v) => fmt(Number(v))} />
        <Bar dataKey="value" name="Insurance AR" radius={[4, 4, 0, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
