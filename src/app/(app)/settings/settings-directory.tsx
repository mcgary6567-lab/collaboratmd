"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";
import type { SettingsLink } from "@/lib/settings-sections";

/** Every setting as a card, filtered as you type. */
export function SettingsDirectory({ sections }: { sections: { title: string; links: SettingsLink[] }[] }) {
  const [q, setQ] = useState("");
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const match = (l: SettingsLink) => words.every((w) => `${l.label} ${l.description} ${l.keywords ?? ""}`.toLowerCase().includes(w));
  const shown = sections.map((s) => ({ ...s, links: s.links.filter((l) => l.href !== "/settings" && match(l)) })).filter((s) => s.links.length);
  return (
    <div>
      <label className="relative block max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} className="input pl-9" placeholder="Find a setting: NPI, write-off, two-factor, Stripe..." aria-label="Find a setting" />
      </label>
      {shown.length === 0 && <p className="mt-6 text-sm text-slate-500">No setting matches &ldquo;{q}&rdquo;.</p>}
      <div className="mt-6 space-y-8">
        {shown.map((s) => (
          <section key={s.title}>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-500">{s.title}</h2>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {s.links.map((l) => (
                <Link key={l.href} href={l.href} className="card block p-4 transition hover:border-brand-300 hover:shadow-md">
                  <p className="font-semibold text-slate-900">{l.label}</p>
                  <p className="mt-1 text-sm text-slate-600">{l.description}</p>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
