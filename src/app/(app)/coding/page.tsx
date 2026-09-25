import Link from "next/link";
import { getDb } from "@/db";
import { requireSession } from "@/lib/auth";
import { listCodes } from "@/server/encounters";
import { noteCodingEnabled } from "@/lib/ai/code-note";
import { Card, PageHeader } from "@/components/ui";
import { DiagnosisFinder, EmCalculator, NoteCoder } from "./tools";

export const dynamic = "force-dynamic";

export default async function CodingPage() {
  await requireSession();
  const db = await getDb();
  const { cpts, icds } = await listCodes(db);
  const codes = (xs: { code: string; description: string }[]) => xs.map(({ code, description }) => ({ code, description }));

  return (
    <>
      <PageHeader
        title="Coding help"
        subtitle="Pick the office visit level and find diagnosis codes before charge entry"
        actions={<Link href="/encounters/new" className="btn btn-primary">Go to charge entry</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Card title="Office visit level (E/M 99202-99215)">
            <EmCalculator cpts={codes(cpts)} />
          </Card>
        </div>
        <Card title="Find a diagnosis code">
          <DiagnosisFinder icds={codes(icds)} />
        </Card>
        <Card title="Suggest codes from a visit note (AI)">
          <NoteCoder enabled={noteCodingEnabled()} />
        </Card>
      </div>
    </>
  );
}
