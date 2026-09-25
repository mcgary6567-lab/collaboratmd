"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type Toast = { id: number; ok: boolean; message: string };
const EVENT = "cmd:toast";

/** Shows a brief confirmation in the corner. Safe to call from any client component. */
export function toast(ok: boolean, message: string) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { ok, message } }));
}

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (e: Event) => {
      const { ok, message } = (e as CustomEvent<{ ok: boolean; message: string }>).detail;
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, ok, message }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ok ? 4000 : 7000);
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`pointer-events-auto flex items-start gap-2 rounded-lg border bg-white px-4 py-3 text-sm shadow-lg ${t.ok ? "border-green-200" : "border-red-200"}`}>
          {t.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
          <span className="text-slate-800">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
