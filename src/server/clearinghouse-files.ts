/**
 * Working with a clearinghouse by file instead of through Stedi's API: many
 * practices already have an account with Office Ally, Availity, Claim.MD or
 * another. The practice downloads its ready claims as one 837 file, uploads
 * it there, marks the claims sent, and later uploads what comes back (999,
 * 277CA, 835), which is read the same way as polled files.
 */
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { tokenize } from "@/lib/edi/x12";
import { parseEdi835 } from "@/lib/edi/x835";
import { describeSyntaxError, parse999 } from "@/lib/edi/x999";
import { applyInbound277, importRemittance, postRemittance, previewClaimEdi } from "./claims";
import { money } from "@/lib/utils";
import { plbForPractice } from "./plb";

const { claims, claimEvents, auditLog, inboundTransactions } = schema;

/**
 * One interchange holding every claim: one functional group per 837 kind
 * (professional, institutional and dental cannot share a group), one
 * transaction set per claim, with control numbers renumbered to be unique.
 */
export function combine837(files: string[]): string {
  if (!files.length) throw new Error("No claims to put in the file");
  const parsed = files.map((f) => tokenize(f));
  const { element: el, segment: term } = parsed[0].delimiters;
  const line = (seg: string[]) => seg.join(el) + term;
  const isa = parsed[0].segments.find((s) => s[0] === "ISA")!;
  const groups = new Map<string, { gs: string[]; sets: string[][][] }>();
  for (const { segments } of parsed) {
    const gs = segments.find((s) => s[0] === "GS")!;
    const version = gs[8];
    const group = groups.get(version) ?? { gs, sets: [] };
    let current: string[][] | null = null;
    for (const seg of segments) {
      if (seg[0] === "ST") current = [seg];
      else if (current) {
        current.push(seg);
        if (seg[0] === "SE") { group.sets.push(current); current = null; }
      }
    }
    groups.set(version, group);
  }
  const out: string[] = [line(isa)];
  let groupNo = 0;
  let setNo = 0;
  for (const { gs, sets } of groups.values()) {
    groupNo++;
    out.push(line([...gs.slice(0, 6), String(groupNo), ...gs.slice(7)]));
    for (const set of sets) {
      setNo++;
      const control = String(setNo).padStart(4, "0");
      for (const seg of set) {
        if (seg[0] === "ST") out.push(line([seg[0], seg[1], control, ...seg.slice(3)]));
        else if (seg[0] === "SE") out.push(line([seg[0], String(set.length), control]));
        else out.push(line(seg));
      }
    }
    out.push(line(["GE", String(sets.length), String(groupNo)]));
  }
  out.push(line(["IEA", String(groups.size), isa[13]]));
  return out.join("\n");
}

/** Every ready claim (or the ones given) as one 837 file. Claims that fail their checks are listed, not included. */
export async function batch837(db: Db, practiceId: string, claimIds?: string[]) {
  const rows = await db.select({ id: claims.id, controlNumber: claims.controlNumber }).from(claims)
    .where(and(eq(claims.practiceId, practiceId), claimIds?.length ? inArray(claims.id, claimIds) : eq(claims.status, "ready")));
  const now = new Date();
  const files: string[] = [];
  const included: { id: string; controlNumber: string }[] = [];
  const skipped: { controlNumber: string; reason: string }[] = [];
  for (const r of rows.slice(0, 500)) {
    try {
      files.push((await previewClaimEdi(db, r.id, { now })).edi);
      included.push(r);
    } catch (e) {
      skipped.push({ controlNumber: r.controlNumber, reason: e instanceof Error ? e.message : "Could not build" });
    }
  }
  if (!files.length) throw new Error(skipped.length ? `No claim could go in the file: ${skipped[0].controlNumber}: ${skipped[0].reason}` : "No ready claims");
  return { edi: combine837(files), included, skipped };
}

/** Claims uploaded to another clearinghouse: sent, from now. */
export async function markSent(db: Db, practiceId: string, claimIds: string[], userId?: string) {
  const rows = await db.select().from(claims).where(and(eq(claims.practiceId, practiceId), inArray(claims.id, claimIds)));
  const now = new Date();
  let marked = 0;
  for (const c of rows) {
    if (!["ready", "rejected"].includes(c.status)) continue;
    await db.update(claims).set({ status: "submitted", submittedAt: now, updatedAt: now }).where(eq(claims.id, c.id));
    await db.insert(claimEvents).values({ claimId: c.id, status: "submitted", source: "user", message: "Sent as a file through another clearinghouse" });
    marked++;
  }
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "claims_sent_by_file", entity: "claim", entityId: null, details: { count: marked } });
  return marked;
}

/** What kind of X12 file this is: 835, 277 or 999. */
export function transactionSetOf(text: string) {
  try {
    return tokenize(text.trim()).segments.find((s) => s[0] === "ST")?.[1] ?? null;
  } catch {
    return null;
  }
}

/** A 999, 277CA or 835 downloaded from the clearinghouse, read once (the same file again changes nothing). */
export async function importResponseFile(db: Db, practiceId: string, text: string, userId?: string) {
  const raw = text.trim();
  const set = transactionSetOf(raw);
  if (!set || !["835", "277", "999"].includes(set)) throw new Error("This is not an 835, 277CA or 999 file");
  const id = `upload:${createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
  const [done] = await db.select().from(inboundTransactions).where(and(eq(inboundTransactions.practiceId, practiceId), eq(inboundTransactions.transactionId, id))).limit(1);
  if (done) return { kind: set, message: `This file was already read: ${done.note ?? "no changes"}` };
  let note: string;
  let remittanceId: string | null = null;
  if (set === "835") {
    const parsed = parseEdi835(raw);
    const numbers = parsed.claims.map((c) => c.patientControlNumber).filter(Boolean);
    const ours = numbers.length ? await db.select({ id: claims.id }).from(claims).where(and(eq(claims.practiceId, practiceId), inArray(claims.controlNumber, numbers))) : [];
    if (!ours.length && !(await plbForPractice(db, practiceId, parsed))) throw new Error("None of the claims in this 835 belong to this practice");
    remittanceId = await importRemittance(db, practiceId, raw, userId);
    await postRemittance(db, remittanceId, userId);
    note = `835: ${parsed.claims.length} claim${parsed.claims.length === 1 ? "" : "s"}, ${money(parsed.totalPaidCents)} posted`;
  } else if (set === "277") {
    const r = await applyInbound277(db, practiceId, raw);
    note = `277CA: ${r.accepted} accepted, ${r.rejected} rejected${r.unmatched ? `, ${r.unmatched} not found here` : ""}`;
  } else {
    const ack = parse999(raw);
    note = `999: the file was ${ack.accepted ? "accepted" : "rejected"}${ack.errors.length ? ` (${ack.errors.slice(0, 2).map((e) => `${e.segmentId} ${describeSyntaxError(e.code)}`).join("; ")})` : ""}. Claim by claim results come in the 277CA.`;
  }
  await db.insert(inboundTransactions).values({ practiceId, transactionId: id, transactionSet: set, remittanceId, note }).onConflictDoNothing();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "clearinghouse_file_uploaded", entity: "inbound", entityId: null, details: { kind: set } });
  return { kind: set, message: note };
}
