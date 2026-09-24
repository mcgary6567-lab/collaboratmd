import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { ADT_A04, DFT_P03 } from "@/lib/hl7/fixtures";
import { get, parseHl7, segment } from "@/lib/hl7/v2";
import { authenticateKey, createIntegrationKey, listMessages, processHl7, revokeIntegrationKey } from "./hl7";
import { importPatients, preview, readTable } from "./import";

describe("integrations against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  let npi: string;
  let adt: string;
  let dft: string;

  beforeAll(async () => {
    t = await testDb();
    const [provider] = await t.db.select().from(schema.providers).where(eq(schema.providers.practiceId, t.practiceId)).limit(1);
    npi = provider.npi;
    const [aetna] = await t.db.select().from(schema.payers).where(and(eq(schema.payers.practiceId, t.practiceId), eq(schema.payers.name, "Aetna"))).limit(1);
    // Point the fixtures at this practice's provider and payer.
    adt = ADT_A04.replaceAll("1234567893", npi).replace("|60054|Aetna|", `|${aetna?.payerId ?? "60054"}|Aetna|`);
    dft = DFT_P03.replaceAll("1234567893", npi);
  });
  afterAll(async () => { await t?.close(); });

  describe("integration keys", () => {
    it("authenticates a key by its hash until it is revoked", async () => {
      const { key, row } = await createIntegrationKey(t.db, t.practiceId, "Epic Bridges", t.userId);
      expect(row.keyHash).not.toContain(key);
      expect(row.prefix).toBe(key.slice(0, 14));
      expect((await authenticateKey(t.db, `Bearer ${key}`))?.practiceId).toBe(t.practiceId);
      expect(await authenticateKey(t.db, `Bearer ${key}x`)).toBeNull();
      expect(await authenticateKey(t.db, null)).toBeNull();
      await revokeIntegrationKey(t.db, t.practiceId, row.id);
      expect(await authenticateKey(t.db, `Bearer ${key}`)).toBeNull();
    });
  });

  describe("HL7 processing", () => {
    it("registers a patient from ADT^A04 with insurance, and acknowledges AA", async () => {
      const r = await processHl7(t.db, t.practiceId, adt, { source: "manual" });
      expect(r.status).toBe("processed");
      expect(r.message).toMatch(/^Patient created/);
      const ack = parseHl7(r.ack);
      expect(get(ack, segment(ack, "MSA"), 1)).toBe("AA");
      const [p] = await t.db.select().from(schema.patients).where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patients.mrn, "MRN44120")));
      expect(p).toMatchObject({ lastName: "O'Brien", firstName: "Siobhan", dob: "1985-03-12", email: "siobhan.obrien@example.com" });
      const [ins] = await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.patientId, p.id));
      expect(ins).toMatchObject({ memberId: "W123456789", groupNumber: "GRP-7781", rank: 1, active: true });
    });

    it("acknowledges a resent message without applying it twice", async () => {
      const r = await processHl7(t.db, t.practiceId, adt, { source: "manual" });
      expect(r.status).toBe("duplicate");
      const rows = await t.db.select().from(schema.patients).where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patients.mrn, "MRN44120")));
      expect(rows).toHaveLength(1);
    });

    it("turns DFT^P03 charges into a scrubbed claim with the EHR's price and pointers", async () => {
      const r = await processHl7(t.db, t.practiceId, dft, { source: "manual" });
      expect(r.status).toBe("processed");
      const claimId = r.result!.claimId as string;
      const [claim] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, claimId));
      expect(["ready", "scrub_errors"]).toContain(claim.status);
      const [enc] = await t.db.select().from(schema.encounters).where(eq(schema.encounters.id, claim.encounterId));
      expect(enc).toMatchObject({ dateOfService: "2026-09-23", diagnoses: ["E119", "I10"] });
      const lines = await t.db.select().from(schema.charges).where(eq(schema.charges.encounterId, enc.id));
      const visit = lines.find((l) => l.cpt === "99214")!;
      expect(visit).toMatchObject({ chargeCents: 18_500, modifiers: ["25"], dxPointers: [1, 2] });
      expect(lines.find((l) => l.cpt === "83036")!.chargeCents).toBeGreaterThan(0); // priced from the fee schedule
    });

    it("answers AE with the reason when the provider is unknown, and AR for unsupported types", async () => {
      const unknownDoc = dft.replace("MSG00002", "MSG00003").replaceAll(npi, "1999999999");
      const r = await processHl7(t.db, t.practiceId, unknownDoc, { source: "manual" });
      expect(r.status).toBe("error");
      expect(r.message).toMatch(/No provider in this practice has NPI 1999999999/);
      expect(get(parseHl7(r.ack), segment(parseHl7(r.ack), "MSA"), 1)).toBe("AE");

      const orm = adt.replace("ADT^A04^ADT_A01", "ORM^O01").replace("MSG00001", "MSG00004");
      const u = await processHl7(t.db, t.practiceId, orm, { source: "manual" });
      expect(get(parseHl7(u.ack), segment(parseHl7(u.ack), "MSA"), 1)).toBe("AR");

      const garbage = await processHl7(t.db, t.practiceId, "hello", { source: "manual" });
      expect(garbage.status).toBe("error");
      const log = await listMessages(t.db, t.practiceId);
      expect(log.map((m) => m.status)).toEqual(expect.arrayContaining(["processed", "duplicate", "error"]));
    });
  });

  describe("universal patient import", () => {
    const csv = [
      "Chart,Pt_Name,BirthDt,Gender,Cell,Primary Payer,Policy #,Group",
      'C-9001,"Nguyen, Linh",4/5/1990,F,(469) 555-0199,Aetna,AET9001,G9',
      "C-9002,Brooks Tom,1971-12-01,M,,Unknown Health Co,UHC1,",
      "C-9003,,1980-01-01,F,,,,",
      'C-9001,"Nguyen, Linh",4/5/1990,F,,,,',
      "C-9004,\"Wu, Amy\",not a date,F,,,,",
    ].join("\n");

    it("previews the mapping and the first rows", () => {
      const p = preview(readTable(csv));
      expect(p.rowCount).toBe(5);
      expect(p.headers[p.mapping.fullName!]).toBe("Pt_Name");
      expect(p.headers[p.mapping.dob!]).toBe("BirthDt");
      expect(p.sample[0]).toMatchObject({ ok: true, value: { firstName: "Linh", lastName: "Nguyen", dob: "1990-04-05", phone: "469-555-0199" } });
    });

    it("imports, skips bad rows with reasons, and matches on the second run instead of duplicating", async () => {
      const { mapping } = preview(readTable(csv));
      const job = await importPatients(t.db, t.practiceId, { filename: "export.csv", text: csv, mapping, mappedBy: "rules", userId: t.userId });
      expect(job).toMatchObject({ totalRows: 5, created: 2, updated: 0, skipped: 3 });
      expect(job.errors).toEqual([
        { row: 3, message: 'Insurance not applied: payer "Unknown Health Co" is not set up for this practice' },
        { row: 4, message: "Missing first or last name" },
        { row: 5, message: "Duplicate of an earlier row in this file" },
        { row: 6, message: 'Unreadable date of birth "not a date"' },
      ]);
      const [linh] = await t.db.select().from(schema.patients).where(and(eq(schema.patients.practiceId, t.practiceId), eq(schema.patients.mrn, "C-9001")));
      const [ins] = await t.db.select().from(schema.patientInsurances).where(eq(schema.patientInsurances.patientId, linh.id));
      expect(ins).toMatchObject({ memberId: "AET9001", groupNumber: "G9" });

      const again = await importPatients(t.db, t.practiceId, { filename: "export.csv", text: csv, mapping, mappedBy: "rules" });
      expect(again).toMatchObject({ created: 0, updated: 2 });
    });

    it("will not import without a date of birth to match on", async () => {
      await expect(importPatients(t.db, t.practiceId, { filename: "x.csv", text: csv, mapping: { fullName: 1 }, mappedBy: "user" })).rejects.toThrow(/date of birth/);
    });
  });
});
