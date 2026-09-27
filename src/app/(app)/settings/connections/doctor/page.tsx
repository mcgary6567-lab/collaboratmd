import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleMinus, CircleX } from "lucide-react";
import { getDb } from "@/db";
import { requireRole } from "@/lib/auth";
import { CHECKS, latestChecks } from "@/server/doctor";
import { runDoctorAction } from "@/app/(app)/doctor-actions";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const ICON = { pass: CheckCircle2, warn: CircleAlert, fail: CircleX, skip: CircleMinus };
const TONE = { pass: "text-green-700", warn: "text-amber-600", fail: "text-red-700", skip: "text-slate-500" };

export default async function DoctorPage() {
  const s = await requireRole(["admin"]);
  const latest = await latestChecks(await getDb(), s.practiceId);
  const services = [...new Set(CHECKS.map((c) => c.service))];
  const ran = [...latest.values()].map((r) => r.ranAt.getTime());
  const failing = [...latest.values()].filter((r) => r.status === "fail").length;

  return (
    <>
      <PageHeader
        title="Integration doctor"
        subtitle="Checks every connected service end to end without affecting anyone: read-only requests, plus a cancelled payment and an unmailed letter in test mode only"
        actions={<Link href="/settings/connections" className="btn btn-secondary">Integrations</Link>}
      />
      <Card className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-slate-600">
            {ran.length ? <>Last run {fmtDateTime(new Date(Math.max(...ran)))}. {failing ? <b className="text-red-700">{failing} failing.</b> : "Nothing failing."}</> : "Not run yet. Run it after connecting a service, and before going live."}
          </p>
          <ActionForm action={runDoctorAction}><SubmitButton pendingLabel="Checking everything...">Run all checks</SubmitButton></ActionForm>
        </div>
      </Card>
      <div className="space-y-6">
        {services.map((svc) => (
          <Card key={svc} title={svc}>
            <ul className="divide-y divide-slate-100">
              {CHECKS.filter((c) => c.service === svc).map((c) => {
                const r = latest.get(c.id);
                const Icon = r ? ICON[r.status] : CircleMinus;
                return (
                  <li key={c.id} className="flex items-start gap-3 py-2.5 text-sm">
                    <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${r ? TONE[r.status] : "text-slate-400"}`} aria-label={r?.status ?? "not run"} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-slate-600">{r?.detail ?? "Not run yet"}</div>
                    </div>
                    <div className="shrink-0 text-right text-xs text-slate-500">
                      {r && <div>{fmtDateTime(r.ranAt)}</div>}
                      {r && r.status !== "pass" && r.lastPass && <div>last passed {fmtDateTime(r.lastPass)}</div>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
