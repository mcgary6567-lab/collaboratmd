"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Tells the server which page was opened (the path only; it is reduced to a pattern there). */
export function UsageBeacon() {
  const path = usePathname();
  useEffect(() => {
    const body = JSON.stringify({ path });
    try {
      if (!navigator.sendBeacon?.("/api/usage", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/usage", { method: "POST", body, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(() => undefined);
      }
    } catch {
      /* usage counts are best effort */
    }
  }, [path]);
  return null;
}
