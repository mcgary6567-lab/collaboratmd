import type { ReactNode } from "react";
import { can, requireSession } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";

/** Reports are an ability a custom role can switch off. */
export default async function ReportsLayout({ children }: { children: ReactNode }) {
  const s = await requireSession();
  if (!can(s, "reports")) {
    return (
      <>
        <PageHeader title="Reports" />
        <Card><p className="text-sm text-slate-600">Your role{s.customRole ? ` (${s.customRole})` : ""} does not include reports. Ask an administrator if you need them.</p></Card>
      </>
    );
  }
  return children;
}
