"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Search, User, CornerDownLeft, Keyboard } from "lucide-react";

type Hit = { kind: "page" | "patient" | "claim"; label: string; detail?: string; href: string };

const OPEN_EVENT = "cmd:open-search";
export const openSearch = () => window.dispatchEvent(new Event(OPEN_EVENT));

/** "g" then a key jumps to a page. */
const JUMPS: Record<string, { href: string; label: string }> = {
  d: { href: "/dashboard", label: "My work" },
  t: { href: "/tasks", label: "Tasks" },
  s: { href: "/scheduling", label: "Scheduling" },
  p: { href: "/patients", label: "Patients" },
  c: { href: "/claims", label: "Claims" },
  f: { href: "/claims/follow-up", label: "Claim follow-up" },
  e: { href: "/remittance", label: "Remittance" },
  n: { href: "/denials", label: "Denials" },
  b: { href: "/billing", label: "Patient billing" },
  r: { href: "/reports", label: "Reports" },
};

export function CommandPalette({ pages }: { pages: { href: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const pendingG = useRef<number>(0);

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setHits([]);
    setActive(0);
  }, []);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    const typing = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (e.key === "Escape") {
        setHelp(false);
        return;
      }
      if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "/") {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "?") {
        setHelp((h) => !h);
      } else if (e.key === "g") {
        pendingG.current = Date.now();
      } else if (pendingG.current && Date.now() - pendingG.current < 1200 && JUMPS[e.key]) {
        pendingG.current = 0;
        router.push(JUMPS[e.key].href);
      }
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener("keydown", onKey);
    };
  }, [router]);

  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim().toLowerCase();
    const pageHits: Hit[] = pages.filter((p) => !term || p.label.toLowerCase().includes(term)).slice(0, term ? 5 : 8).map((p) => ({ kind: "page", label: p.label, href: p.href }));
    setHits(pageHits);
    setActive(0);
    if (term.length < 2) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q.trim())}`, { signal: ctrl.signal });
        if (!res.ok) return;
        const data = (await res.json()) as Hit[];
        setHits([...data, ...pageHits]);
      } catch {
        /* aborted by the next keystroke */
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q, open, pages]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    close();
    router.push(h.href);
  };

  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]" onClick={close}>
          <div className="w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Search">
            <div className="flex items-center gap-2 border-b border-slate-200 px-4">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
                  else if (e.key === "Enter") go(hits[active]);
                  else if (e.key === "Escape") close();
                }}
                placeholder="Patient name or MRN, claim number, or a page"
                className="h-12 w-full bg-transparent text-sm outline-none"
              />
              <kbd className="rounded border border-slate-200 px-1.5 font-mono text-[10px] text-slate-400">Esc</kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto py-2">
              {hits.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">No matches.</li>}
              {hits.map((h, i) => {
                const Icon = h.kind === "patient" ? User : h.kind === "claim" ? FileText : CornerDownLeft;
                return (
                  <li key={`${h.kind}:${h.href}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(h)}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${i === active ? "bg-brand-50 text-brand-700" : "text-slate-700"}`}
                    >
                      <Icon className="h-4 w-4 shrink-0 opacity-60" />
                      <span className="truncate">{h.label}</span>
                      {h.detail && <span className="ml-auto truncate text-xs text-slate-400">{h.detail}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center gap-3 border-t border-slate-200 px-4 py-2 text-[11px] text-slate-400">
              <span>↑↓ to move · Enter to open</span>
              <button type="button" className="ml-auto inline-flex items-center gap-1 hover:text-slate-600" onClick={() => { close(); setHelp(true); }}>
                <Keyboard className="h-3 w-3" /> Shortcuts
              </button>
            </div>
          </div>
        </div>
      )}
      {help && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setHelp(false)}>
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 text-base font-bold">Keyboard shortcuts</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt><kbd className="font-mono">Ctrl K</kbd> or <kbd className="font-mono">/</kbd></dt><dd>Search</dd>
              <dt><kbd className="font-mono">?</kbd></dt><dd>This list</dd>
              {Object.entries(JUMPS).map(([k, v]) => (
                <div key={k} className="contents"><dt><kbd className="font-mono">g {k}</kbd></dt><dd>{v.label}</dd></div>
              ))}
            </dl>
            <button type="button" className="btn btn-secondary mt-4 w-full justify-center" onClick={() => setHelp(false)}>Close</button>
          </div>
        </div>
      )}
    </>
  );
}
