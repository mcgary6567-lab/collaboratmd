"use client";

import { useEffect, useRef, useState } from "react";
import { searchCodesAction } from "@/app/(app)/code-search-actions";

export type CodeOption = { code: string; description: string };

/**
 * The options for a code field: the list the page came with, plus matches for
 * what was last typed (after a short pause), so the full code sets can be
 * searched without sending them all to the browser.
 */
export function useCodeSearch(kind: "dx" | "px", base: CodeOption[]) {
  const [q, setQ] = useState("");
  const [found, setFound] = useState<CodeOption[]>([]);
  const last = useRef("");
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2 || base.some((b) => b.code === term.toUpperCase())) return;
    const t = setTimeout(async () => {
      last.current = term;
      const rows = await searchCodesAction(kind, term).catch(() => []);
      if (last.current === term) setFound(rows);
    }, 250);
    return () => clearTimeout(t);
  }, [q, kind, base]);
  const seen = new Set<string>();
  const options = [...found, ...base].filter((o) => !seen.has(o.code) && seen.add(o.code));
  const describe = (code: string) => options.find((o) => o.code === code.trim().toUpperCase())?.description;
  return { options, search: setQ, describe };
}

/** A datalist of code options. */
export function CodeList({ id, options }: { id: string; options: CodeOption[] }) {
  return <datalist id={id}>{options.map((c) => <option key={c.code} value={c.code}>{c.description}</option>)}</datalist>;
}
