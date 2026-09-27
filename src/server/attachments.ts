/**
 * Claim attachments: records that support a claim (operative notes, x-rays,
 * a primary payer's EOB). Each one gets an attachment control number, and the
 * claim carries a PWK segment naming the document type, how it is being sent
 * and that number, so the payer can match the two.
 *
 * Sending the document itself: by fax or mail with the printable cover
 * sheet, or through the payer's or clearinghouse's upload portal quoting the
 * control number. Electronic delivery as an X12 275 transaction is not built.
 */
import crypto from "node:crypto";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import type { ClaimAttachmentRef } from "@/lib/edi/x837p";
import { fileStore, streamToBuffer } from "./files";

const { claimAttachments, claims, auditLog } = schema;

/** PWK01 report types practices use most. */
export const REPORT_TYPES: Record<string, string> = {
  OZ: "Support data for the claim",
  M1: "Medical record attachment",
  OB: "Operative note",
  DS: "Discharge summary",
  DG: "Diagnostic report",
  LA: "Laboratory results",
  P4: "Pathology report",
  RR: "Radiology report",
  RB: "Radiology films (x-rays)",
  EB: "Explanation of benefits (other payer)",
  B4: "Referral form",
  "09": "Progress report",
  "08": "Plan of treatment",
  PN: "Physical therapy notes",
  CK: "Consent form",
  DA: "Dental models",
  XP: "Photographs",
};

/** PWK02: how the document reaches the payer. */
export const TRANSMISSIONS: Record<string, string> = {
  FX: "By fax",
  BM: "By mail",
  EL: "Electronically (payer or clearinghouse upload)",
  EM: "By email",
  FT: "By file transfer",
  AA: "Available on request at the practice",
};

const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/tiff"]);
export const MAX_BYTES = 5_000_000;
const MAX_PER_CLAIM = 10;

export async function addAttachment(db: Db, practiceId: string, claimId: string, file: { name: string; type: string; bytes: Buffer }, input: { reportType: string; transmission: string }, userId?: string) {
  const [claim] = await db.select().from(claims).where(and(eq(claims.id, claimId), eq(claims.practiceId, practiceId))).limit(1);
  if (!claim) throw new Error("Claim not found");
  if (!(input.reportType in REPORT_TYPES)) throw new Error("Choose what kind of document it is");
  if (!(input.transmission in TRANSMISSIONS)) throw new Error("Choose how it will be sent");
  if (!TYPES.has(file.type)) throw new Error("Attach a PDF, JPEG, PNG or TIFF");
  if (!file.bytes.length) throw new Error("The file is empty");
  if (file.bytes.length > MAX_BYTES) throw new Error("Files are limited to 5 MB");
  const existing = await db.select({ id: claimAttachments.id }).from(claimAttachments).where(eq(claimAttachments.claimId, claimId));
  if (existing.length >= MAX_PER_CLAIM) throw new Error(`A claim can have up to ${MAX_PER_CLAIM} attachments`);
  // PWK06 allows up to 50 characters; the claim's control number plus a sequence is unique and easy to quote.
  const controlNumber = `${claim.controlNumber}A${existing.length + 1}`;
  const safeName = file.name.replace(/[^\w.\- ]/g, "_").slice(0, 120) || "attachment";
  const store = fileStore();
  const storageKey = store ? await store.put(`practices/${practiceId}/attachments/${controlNumber}-${safeName.replace(/\s+/g, "_")}`, file.bytes, file.type) : null;
  const [row] = await db.insert(claimAttachments).values({
    practiceId, claimId, reportType: input.reportType, transmission: input.transmission, controlNumber,
    filename: safeName, contentType: file.type, sizeBytes: file.bytes.length,
    sha256: crypto.createHash("sha256").update(file.bytes).digest("hex"), dataBase64: storageKey ? null : file.bytes.toString("base64"), storageKey, createdBy: userId ?? null,
  }).returning();
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "attachment_added", entity: "claim", entityId: claimId, details: { reportType: input.reportType, bytes: file.bytes.length } });
  return { id: row.id, controlNumber: row.controlNumber };
}

/** Everything but the file itself. */
export async function listAttachments(db: Db, practiceId: string, claimId: string) {
  return db
    .select({ id: claimAttachments.id, reportType: claimAttachments.reportType, transmission: claimAttachments.transmission, controlNumber: claimAttachments.controlNumber, filename: claimAttachments.filename, contentType: claimAttachments.contentType, sizeBytes: claimAttachments.sizeBytes, sentAt: claimAttachments.sentAt, createdAt: claimAttachments.createdAt })
    .from(claimAttachments)
    .where(and(eq(claimAttachments.practiceId, practiceId), eq(claimAttachments.claimId, claimId)))
    .orderBy(asc(claimAttachments.createdAt));
}

export async function getAttachmentFile(db: Db, practiceId: string, id: string) {
  const [row] = await db.select().from(claimAttachments).where(and(eq(claimAttachments.id, id), eq(claimAttachments.practiceId, practiceId))).limit(1);
  return row ?? null;
}

/** The file's bytes, from the row or the external store. */
export async function attachmentBytes(row: { dataBase64: string | null; storageKey: string | null }): Promise<Buffer> {
  if (row.dataBase64 !== null) return Buffer.from(row.dataBase64, "base64");
  const store = fileStore();
  if (!row.storageKey || !store) throw new Error("This file is kept in file storage, which is not configured here");
  const stream = await store.get(row.storageKey);
  if (!stream) throw new Error("The file is missing from file storage");
  return streamToBuffer(stream);
}

/**
 * Moves attachments still held in the database into the external store, a
 * batch at a time, checking each copy against its SHA-256 before clearing the row.
 */
export async function moveAttachmentsToStore(db: Db, limit = 100) {
  const store = fileStore();
  if (!store) throw new Error("Set FILE_STORAGE=blob and connect a private Blob store first");
  const rows = await db.select().from(claimAttachments).where(isNull(claimAttachments.storageKey)).limit(limit);
  let moved = 0;
  for (const r of rows) {
    if (r.dataBase64 === null) continue;
    const bytes = Buffer.from(r.dataBase64, "base64");
    const key = await store.put(`practices/${r.practiceId}/attachments/${r.controlNumber}-${r.filename.replace(/\s+/g, "_")}`, bytes, r.contentType);
    const back = await store.get(key);
    const copy = back ? await streamToBuffer(back) : null;
    if (!copy || crypto.createHash("sha256").update(copy).digest("hex") !== r.sha256) {
      await store.del([key]);
      throw new Error(`The stored copy of attachment ${r.controlNumber} did not match; stopped`);
    }
    await db.update(claimAttachments).set({ storageKey: key, dataBase64: null }).where(eq(claimAttachments.id, r.id));
    moved++;
  }
  const [{ left }] = await db.select({ left: sql<number>`count(*)::int` }).from(claimAttachments).where(isNull(claimAttachments.storageKey));
  return { moved, left: Number(left) };
}

export async function removeAttachment(db: Db, practiceId: string, id: string, userId?: string) {
  const [row] = await db.select().from(claimAttachments).where(and(eq(claimAttachments.id, id), eq(claimAttachments.practiceId, practiceId))).limit(1);
  if (!row) throw new Error("Attachment not found");
  if (row.sentAt) throw new Error("This attachment was referenced on a submitted claim, so it is kept");
  await db.delete(claimAttachments).where(eq(claimAttachments.id, id));
  if (row.storageKey) await fileStore()?.del([row.storageKey]);
  await db.insert(auditLog).values({ practiceId, userId: userId ?? null, action: "attachment_removed", entity: "claim", entityId: row.claimId });
}

/** The PWK references for a claim about to be sent. */
export async function attachmentRefs(db: Db, claimId: string): Promise<ClaimAttachmentRef[]> {
  return db.select({ reportType: claimAttachments.reportType, transmission: claimAttachments.transmission, controlNumber: claimAttachments.controlNumber }).from(claimAttachments).where(eq(claimAttachments.claimId, claimId)).orderBy(asc(claimAttachments.createdAt));
}

export async function markAttachmentsSent(db: Db, claimId: string, at: Date) {
  await db.update(claimAttachments).set({ sentAt: at }).where(and(eq(claimAttachments.claimId, claimId), isNull(claimAttachments.sentAt)));
}
