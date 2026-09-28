import { getDb } from "@/db";
import { questionnaireCsv } from "@/content/security-questionnaire";
import { lastRestoreTest } from "@/server/restore-tests";

export const dynamic = "force-dynamic";

export async function GET() {
  const last = await lastRestoreTest(await getDb()).catch(() => null);
  const summary = last ? `${last.testedAt.toISOString().slice(0, 10)}, ${last.result}` : null;
  return new Response(questionnaireCsv(summary), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="collaboratmd-security-questionnaire.csv"' } });
}
