import type { ReactNode } from "react";
import { requireSession } from "@/lib/auth";
import { settingsFor } from "@/lib/settings-sections";
import { SettingsNav } from "./settings-nav";

/** Settings pages share a menu of every setting, grouped. */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  return (
    <div className="flex gap-8">
      <aside className="no-print hidden w-52 shrink-0 xl:block">
        <SettingsNav sections={settingsFor(s.role)} />
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
