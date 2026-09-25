"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SettingsLink } from "@/lib/settings-sections";

/** The settings menu beside every settings page (wide screens). */
export function SettingsNav({ sections }: { sections: { title: string; links: SettingsLink[] }[] }) {
  const pathname = usePathname();
  const active = sections.flatMap((s) => s.links.map((l) => l.href)).filter((h) => pathname === h || (h !== "/settings" && pathname.startsWith(h + "/"))).sort((a, b) => b.length - a.length)[0];
  return (
    <nav aria-label="Settings" className="sticky top-6 space-y-5 text-sm">
      {sections.map((s) => (
        <div key={s.title}>
          <p className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">{s.title}</p>
          <ul className="space-y-0.5">
            {s.links.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={`block rounded-lg px-2 py-1.5 ${active === l.href ? "bg-brand-50 font-semibold text-brand-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"}`}>{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
