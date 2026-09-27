import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { memoryStore, setFileStore, streamToBuffer } from "./files";
import { addAttachment, attachmentBytes, moveAttachmentsToStore } from "./attachments";
import { continuationToken, expireExports, openExport, queueExport, runExport, validContinuation } from "./export-jobs";

describe("file storage", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  const store = memoryStore();
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });
  afterEach(() => setFileStore(undefined));

  it("keeps new attachments in the store, moves old ones after checking them, and reads both", async () => {
    const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    setFileStore(null);
    const inDb = await addAttachment(t.db, t.practiceId, claim.id, { name: "old note.pdf", type: "application/pdf", bytes: Buffer.from("old") }, { reportType: "OZ", transmission: "FX" }, t.userId);
    setFileStore(store);
    const inStore = await addAttachment(t.db, t.practiceId, claim.id, { name: "new note.pdf", type: "application/pdf", bytes: Buffer.from("new") }, { reportType: "OZ", transmission: "FX" }, t.userId);
    const [a] = await t.db.select().from(schema.claimAttachments).where(eq(schema.claimAttachments.id, inStore.id));
    expect(a.dataBase64).toBeNull();
    expect(a.storageKey).toMatch(/^practices\/.+\/attachments\//);
    expect((await attachmentBytes(a)).toString()).toBe("new");

    expect(await moveAttachmentsToStore(t.db)).toEqual({ moved: 1, left: 0 });
    const [b] = await t.db.select().from(schema.claimAttachments).where(eq(schema.claimAttachments.id, inDb.id));
    expect(b.dataBase64).toBeNull();
    expect((await attachmentBytes(b)).toString()).toBe("old");
  });

  it("prepares an export in the background, serves it, and deletes it after a week", async () => {
    setFileStore(null);
    await expect(queueExport(t.db, t.practiceId, t.userId)).rejects.toThrow(/file storage/);
    setFileStore(store);
    const job = await queueExport(t.db, t.practiceId, t.userId);
    await expect(queueExport(t.db, t.practiceId, t.userId)).rejects.toThrow(/already being prepared/);
    const now = new Date("2026-09-26T12:00:00Z");
    expect(await runExport(t.db, job.id, { now: () => now })).toEqual({ done: true, built: 1 });
    const [row] = await t.db.select().from(schema.exportJobs).where(eq(schema.exportJobs.id, job.id));
    expect(row.bytes).toBeGreaterThan(1000);
    expect(row.parts).toHaveLength(1);
    expect(await runExport(t.db, job.id)).toEqual({ done: true, built: 0 });

    const opened = await openExport(t.db, t.practiceId, job.id, now);
    const files = unzipSync(new Uint8Array(await streamToBuffer(opened!.stream)));
    expect(strFromU8(files["README.txt"])).toContain("CollaboratMD practice export");
    expect(Object.keys(files).some((k) => k.startsWith("attachments/"))).toBe(true);
    expect(await openExport(t.db, "00000000-0000-4000-8000-000000000000", job.id, now)).toBeNull();

    const later = new Date(now.getTime() + 8 * 86_400_000);
    expect(await expireExports(t.db, later)).toBe(1);
    expect(await openExport(t.db, t.practiceId, job.id, later)).toBeNull();
    expect([...store.files.keys()].some((k) => k.includes("/exports/"))).toBe(false);
    const [n] = await t.db.select().from(schema.notifications).where(eq(schema.notifications.kind, "export_ready"));
    expect(n.title).toBe("Your practice data export is ready");
  });

  it("exports a large practice in parts across runs, each row exactly once", async () => {
    setFileStore(store);
    const job = await queueExport(t.db, t.practiceId, t.userId);
    const now = new Date("2026-09-27T12:00:00Z");
    const continued: string[] = [];
    const opts = { now: () => now, budgetMs: -1, continueWith: async (id: string) => { continued.push(id); }, planOpts: { chunkRows: 3, partRows: 10, filesPerPart: 1 } };
    // Every run stops after one part and hands on to the next.
    let r = await runExport(t.db, job.id, opts);
    expect(r).toEqual({ done: false, built: 1 });
    for (let i = 0; i < 200 && !r!.done; i++) r = await runExport(t.db, job.id, opts);
    expect(r!.done).toBe(true);
    const [row] = await t.db.select().from(schema.exportJobs).where(eq(schema.exportJobs.id, job.id));
    const total = row.plan!.length;
    expect(total).toBeGreaterThan(2);
    expect(row.parts).toHaveLength(total);
    expect(continued).toHaveLength(total - 1);

    const patientIds: string[] = [];
    let attachments = 0;
    for (let i = 0; i < total; i++) {
      const opened = await openExport(t.db, t.practiceId, job.id, now, i);
      expect(opened!.parts).toBe(total);
      const files = unzipSync(new Uint8Array(await streamToBuffer(opened!.stream)));
      expect(strFromU8(files["README.txt"])).toContain(`Part ${i + 1} of ${total}`);
      for (const [name, bytes] of Object.entries(files)) {
        if (/^tables\/patients(\.part\d+)?\.csv$/.test(name)) {
          const [header, ...lines] = strFromU8(bytes).trim().split("\r\n");
          const idCol = header.split(",").indexOf("id");
          patientIds.push(...lines.filter(Boolean).map((l) => l.split(",")[idCol]));
        }
        if (name.startsWith("attachments/")) attachments++;
      }
    }
    const patients = await t.db.select({ id: schema.patients.id }).from(schema.patients).where(eq(schema.patients.practiceId, t.practiceId));
    expect(patients.length).toBeGreaterThan(3);
    expect(patientIds.sort()).toEqual(patients.map((p) => p.id).sort());
    const stored = await t.db.select({ id: schema.claimAttachments.id }).from(schema.claimAttachments).where(eq(schema.claimAttachments.practiceId, t.practiceId));
    expect(attachments).toBe(stored.length);
    expect(await openExport(t.db, t.practiceId, job.id, now, total)).toBeNull();

    // Every part is deleted when the export expires.
    expect(await expireExports(t.db, new Date(now.getTime() + 8 * 86_400_000))).toBeGreaterThanOrEqual(1);
    expect([...store.files.keys()].some((k) => k.includes("/exports/"))).toBe(false);
  }, 120_000); // dozens of small parts, each a zip: slow by design

  it("only accepts continuation tokens this server made for that export", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    expect(validContinuation(id, continuationToken(id))).toBe(true);
    expect(validContinuation("22222222-2222-4222-8222-222222222222", continuationToken(id))).toBe(false);
    expect(validContinuation(id, "")).toBe(false);
  });
});
