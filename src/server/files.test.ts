import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { memoryStore, setFileStore, streamToBuffer } from "./files";
import { addAttachment, attachmentBytes, moveAttachmentsToStore } from "./attachments";
import { expireExports, openExport, queueExport, runExport } from "./export-jobs";

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
    const r = await runExport(t.db, job.id, () => now);
    expect(r!.bytes).toBeGreaterThan(1000);
    expect(await runExport(t.db, job.id)).toBeNull();

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
});
