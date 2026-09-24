import Link from "next/link";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { requireSession } from "@/lib/auth";
import { listIntegrationKeys, listMessages, messageStats } from "@/server/hl7";
import { revokeKeyAction } from "@/app/(app)/integration-actions";
import { ADT_A04, DFT_P03 } from "@/lib/hl7/fixtures";
import { Badge, Card, Empty, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/utils";
import { CreateKeyForm, TestMessageForm } from "./forms";

export const dynamic = "force-dynamic";

const TONE: Record<string, "green" | "red" | "slate"> = { processed: "green", error: "red", duplicate: "slate" };

export default async function IntegrationsPage() {
  const s = await requireSession();
  const db = await getDb();
  const [keys, messages, stats, provider, payer] = await Promise.all([
    listIntegrationKeys(db, s.practiceId),
    listMessages(db, s.practiceId, 50),
    messageStats(db, s.practiceId),
    db.select().from(schema.providers).where(eq(schema.providers.practiceId, s.practiceId)).orderBy(asc(schema.providers.lastName)).limit(1),
    db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, s.practiceId), eq(schema.payers.type, "commercial"))).limit(1),
  ]);
  const admin = s.role === "admin";
  // Samples pointed at this practice's own provider and payer, so they process cleanly.
  const localize = (m: string) =>
    m.replaceAll("1234567893", provider[0]?.npi ?? "1234567893").replace("|60054|Aetna|", `|${payer[0]?.payerId ?? "60054"}|${payer[0]?.name ?? "Aetna"}|`);
  const samples = [
    { label: "sample ADT^A04 (new patient)", message: localize(ADT_A04) },
    { label: "sample DFT^P03 (charges)", message: localize(DFT_P03) },
  ];

  return (
    <>
      <PageHeader
        title="EHR integrations"
        subtitle="Receive patients and charges from an EHR over HL7 v2"
        actions={<Link href="/settings" className="btn btn-secondary">Back to settings</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="How to connect">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
              <li>Create a key below for the interface engine or EHR that will send messages.</li>
              <li>
                Point its HTTP destination at <code className="rounded bg-slate-100 px-1 font-mono text-xs">POST /api/hl7</code> on this site with the header{" "}
                <code className="rounded bg-slate-100 px-1 font-mono text-xs">Authorization: Bearer &lt;key&gt;</code>, one message per request.
              </li>
              <li>
                Send <span className="font-medium">ADT</span> A01, A04, A05, A08, A28 or A31 to register and update patients and their primary insurance, and{" "}
                <span className="font-medium">DFT^P03</span> to post charges. Each DFT becomes a claim that goes through the scrubber. Labs send{" "}
                <span className="font-medium">ORU^R01</span> results, which attach to the matching order.
              </li>
              <li>The response body is the HL7 ACK: AA applied, AE fix and resend, AR not supported. A resent message (same MSH-10) is acknowledged but not applied twice.</li>
            </ol>
            <p className="mt-3 text-xs text-slate-500">
              HL7 over HTTP only: engines such as Mirth Connect, Rhapsody or Iguana forward an MLLP feed to an HTTP destination. Payers are matched by their
              clearinghouse ID in IN1-3 or their name in IN1-4, and providers by the NPI in FT1-20 or PV1-7.
            </p>
          </Card>

          <Card title={`Messages · last 30 days: ${stats.processed ?? 0} processed, ${stats.error ?? 0} errors, ${stats.duplicate ?? 0} duplicates`}>
            {messages.length === 0 ? (
              <Empty>No messages yet. Process a sample below to see how one is handled.</Empty>
            ) : (
              <table className="table">
                <thead><tr><th>Received</th><th>Type</th><th>Control ID</th><th>Source</th><th>Result</th></tr></thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-xs">{fmtDateTime(m.receivedAt)}</td>
                      <td className="font-mono text-xs">{m.messageType}</td>
                      <td className="font-mono text-xs">{m.controlId || "none"}</td>
                      <td className="text-xs">{m.source === "api" ? "API" : "Test"}</td>
                      <td className="text-xs">
                        <Badge tone={TONE[m.status] ?? "slate"}>{m.status}</Badge>{" "}
                        <span className={m.status === "error" ? "text-red-800" : "text-slate-600"}>{m.error ?? String((m.result as { message?: string } | null)?.message ?? "")}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card title="Test a message">
            <p className="mb-2 text-sm text-slate-600">Processes a message exactly as the API would, against real data in this practice.</p>
            <TestMessageForm samples={samples} />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Integration keys">
            {admin ? <CreateKeyForm /> : <p className="text-sm text-slate-600">Only an administrator can create or revoke keys.</p>}
            <ul className="mt-4 space-y-2 text-sm">
              {keys.length === 0 && <li className="text-slate-500">No keys yet.</li>}
              {keys.map((k) => (
                <li key={k.id} className={`rounded-lg border p-2 ${k.revokedAt ? "border-slate-200 opacity-60" : "border-slate-200"}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{k.name}</span>
                    {k.revokedAt ? <Badge>Revoked</Badge> : <Badge tone="green">Active</Badge>}
                  </div>
                  <div className="font-mono text-xs text-slate-500">{k.prefix}…</div>
                  <div className="text-xs text-slate-500">Last used {k.lastUsedAt ? fmtDateTime(k.lastUsedAt) : "never"}</div>
                  {!k.revokedAt && admin && (
                    <form action={revokeKeyAction.bind(null, k.id)} className="mt-1">
                      <button className="text-xs font-semibold text-red-700 hover:underline">Revoke</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Importing a patient list">
            <p className="text-sm text-slate-600">Moving from another system? Import its patient export as a CSV file instead.</p>
            <Link href="/import" className="btn btn-secondary mt-3 text-xs">Import patients from a file</Link>
          </Card>
        </div>
      </div>
    </>
  );
}
