/**
 * Remittances from the clearinghouse without anyone downloading files: each
 * run asks Stedi for payer transactions that arrived since the last run, and
 * every 835 whose claims belong to this practice is imported and auto-posted.
 *
 * Claim control numbers are unique only within a practice, so an 835 fetched
 * with a Stedi key shared by several practices could not be placed safely.
 * Polling therefore runs with the practice's own Stedi key, or with the
 * deployment's key only when the deployment has a single practice.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { getClearinghouse, type ClearinghouseGateway } from "@/lib/clearinghouse/gateway";
import { parseEdi835 } from "@/lib/edi/x835";
import { practiceConfig } from "./integrations";
import { importRemittance, postRemittance } from "./claims";
import { notify } from "./notifications";

const { clearinghousePolls, inboundTransactions, claims, practices } = schema;
const MAX_PAGES = 10;

export async function pollStatus(db: Db, practiceId: string) {
  const [row] = await db.select().from(clearinghousePolls).where(eq(clearinghousePolls.practiceId, practiceId)).limit(1);
  return row ?? null;
}

/** Why this practice cannot poll, or null when it can. */
export async function pollBlocker(db: Db, practiceId: string): Promise<string | null> {
  const cfg = await practiceConfig(db, practiceId);
  if (!cfg.stedi) return "Connect Stedi under Integrations to receive remittances automatically";
  if (cfg.sources.stedi === "practice") return null;
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(practices);
  return Number(n) > 1 ? "This practice uses the deployment's shared Stedi key. Save the practice's own Stedi key under Integrations to receive its remittances automatically." : null;
}

export async function pollRemittances(db: Db, practiceId: string, opts: { now?: Date; userId?: string; gateway?: Pick<ClearinghouseGateway, "pollInbound"> } = {}) {
  if (!opts.gateway) {
    const blocker = await pollBlocker(db, practiceId);
    if (blocker) throw new Error(blocker);
  }
  const gateway = opts.gateway ?? getClearinghouse((await practiceConfig(db, practiceId)).stedi?.apiKey);
  if (!gateway.pollInbound) throw new Error("This clearinghouse does not support polling");
  const now = opts.now ?? new Date();
  const state = await pollStatus(db, practiceId);
  // First run looks back 30 days; Stedi wants a start at least a minute in the past.
  const since = new Date(now.getTime() - 30 * 86_400_000);
  let cursor = state?.cursor ?? null;
  const summary = { seen: 0, imported: 0, skipped: 0, paidCents: 0, errors: [] as string[] };
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await gateway.pollInbound(cursor, since);
      for (const item of r.items) {
        summary.seen++;
        const [done] = await db.select().from(inboundTransactions).where(and(eq(inboundTransactions.practiceId, practiceId), eq(inboundTransactions.transactionId, item.transactionId))).limit(1);
        if (done) continue;
        let remittanceId: string | null = null;
        let note: string | null = null;
        if (item.transactionSet === "835" && item.x12) {
          const parsed = parseEdi835(item.x12);
          const numbers = parsed.claims.map((c) => c.patientControlNumber).filter(Boolean);
          const ours = numbers.length ? await db.select({ id: claims.id }).from(claims).where(and(eq(claims.practiceId, practiceId), inArray(claims.controlNumber, numbers))) : [];
          if (!ours.length) {
            note = "No claims in this 835 belong to this practice";
            summary.skipped++;
          } else {
            remittanceId = await importRemittance(db, practiceId, item.x12, opts.userId);
            await postRemittance(db, remittanceId, opts.userId);
            summary.imported++;
            summary.paidCents += parsed.totalPaidCents;
          }
        } else {
          note = item.transactionSet === "835" ? "No X12 file in Stedi's response" : `Transaction set ${item.transactionSet} (not a remittance)`;
        }
        await db.insert(inboundTransactions).values({ practiceId, transactionId: item.transactionId, transactionSet: item.transactionSet, remittanceId, note }).onConflictDoNothing();
      }
      const moved = r.cursor && r.cursor !== cursor;
      cursor = r.cursor || cursor;
      if (!r.items.length || !moved) break;
    }
    await db.insert(clearinghousePolls).values({ practiceId, cursor, lastPolledAt: now, lastError: null, erasImported: summary.imported })
      .onConflictDoUpdate({ target: clearinghousePolls.practiceId, set: { cursor, lastPolledAt: now, lastError: null, erasImported: sql`${clearinghousePolls.erasImported} + ${summary.imported}` } });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : "Polling failed";
    await db.insert(clearinghousePolls).values({ practiceId, cursor, lastPolledAt: now, lastError: message }).onConflictDoUpdate({ target: clearinghousePolls.practiceId, set: { cursor, lastPolledAt: now, lastError: message } });
    throw e;
  }
  if (summary.imported) {
    await notify(db, practiceId, { kind: "eras", title: `${summary.imported} remittance${summary.imported === 1 ? "" : "s"} posted from Stedi`, body: `$${(summary.paidCents / 100).toFixed(2)} in payments posted automatically.`, href: "/remittance" });
  }
  return summary;
}
