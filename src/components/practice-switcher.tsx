"use client";

import { useRef } from "react";
import { switchPracticeAction } from "@/app/(app)/practice-actions";

/** Lets a user with access to several practices move between them. */
export function PracticeSwitcher({ practices, current }: { practices: { id: string; name: string }[]; current: string }) {
  const form = useRef<HTMLFormElement>(null);
  const currentName = practices.find((p) => p.id === current)?.name ?? "";
  if (practices.length < 2) {
    return <div className="truncate px-5 pb-3 text-xs font-medium text-slate-500" title={currentName}>{currentName}</div>;
  }
  return (
    <form ref={form} action={switchPracticeAction} className="px-4 pb-3">
      <label className="sr-only" htmlFor="practice-switch">Practice</label>
      <select
        id="practice-switch"
        name="practiceId"
        defaultValue={current}
        onChange={() => form.current?.requestSubmit()}
        className="input py-1.5 text-xs font-medium"
      >
        {practices.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
    </form>
  );
}
