import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@/db";
import { testDb } from "@/test/db";
import { buildEdi837D } from "@/lib/edi/x837d";
import { isValidTooth, scrubDental } from "@/lib/scrub/dental";
import { addAttachment, listAttachments, removeAttachment } from "./attachments";
import { createDentalClaim } from "./dental";
import { previewClaimEdi, submitClaim } from "./claims";
import { listErrors, recordError, redact, resolveError } from "./errors";

describe("error monitoring", () => {
  it("masks what could identify a patient before storing a message", () => {
    expect(redact('Key (email)=(jane@example.com) already exists')).toBe("Key (email)=([value]) already exists");
    expect(redact("No patient jane.doe@example.org born 1980-02-03, member W123456789")).toBe("No patient [email] born [date], member [number]");
    expect(redact('invalid input "Smith"')).toBe('invalid input "[value]"');
  });
});

describe("837D and the dental scrubber", () => {
  const line = (over: Partial<Parameters<typeof scrubDental>[0]["lines"][number]> = {}) => ({ lineNumber: 1, cdt: "D2392", tooth: "30", surfaces: "MO", oralCavity: null, units: 1, chargeCents: 21_000, ...over });
  const base = { billingNpi: "1234567893", renderingNpi: "1234567893", memberId: "M1", payerId: "P1", dateOfService: "2026-09-01", today: "2026-09-25" };

  it("checks CDT codes, teeth, surfaces and quadrants", () => {
    expect(scrubDental({ ...base, lines: [line()] })).toEqual([]);
    expect(isValidTooth("32") && isValidTooth("A") && isValidTooth("AS") && isValidTooth("51")).toBe(true);
    expect(isValidTooth("33") || isValidTooth("U") || isValidTooth("0")).toBe(false);
    const rules = (l: ReturnType<typeof line>) => scrubDental({ ...base, lines: [l] }).map((f) => f.rule);
    expect(rules(line({ cdt: "2392" }))).toEqual(["CDT_FORMAT"]);
    expect(rules(line({ tooth: null, surfaces: null }))).toEqual(["TOOTH_REQUIRED", "SURFACE_REQUIRED"]);
    expect(rules(line({ surfaces: "MOX" }))).toEqual(["SURFACE_CODE"]);
    expect(rules(line({ surfaces: "MM" }))).toEqual(["SURFACE_REPEAT"]);
    expect(rules(line({ cdt: "D4341", tooth: null, surfaces: null }))).toEqual(["QUADRANT_REQUIRED"]);
    expect(rules(line({ cdt: "D4341", tooth: null, surfaces: null, oralCavity: "10" }))).toEqual([]);
    expect(rules(line({ cdt: "D1110", tooth: null, surfaces: null }))).toEqual([]);
    expect(rules(line({ cdt: "D2740", surfaces: null }))).toEqual([]); // a crown needs the tooth, not surfaces
  });

  it("builds SV3, TOO and line dates, with PWK for attachments", () => {
    const edi = buildEdi837D({
      controlNumber: "CMD1", interchangeControl: "123", senderId: "S", receiverId: "R", now: new Date("2026-09-25T12:00:00Z"),
      billingProvider: { name: "Smile Dental", npi: "1234567893", taxId: "12-3456789", address1: "1 Main", city: "Dallas", state: "TX", zip: "75201", taxonomy: "1223G0001X" },
      rendering: { lastName: "Tooth", firstName: "Terry", npi: "1234567893", taxonomy: "1223G0001X" },
      payer: { name: "Delta", payerId: "DDX", type: "commercial" },
      subscriber: { lastName: "Doe", firstName: "Jane", memberId: "M1", dob: "1980-02-03", sex: "F", relationship: "self" },
      claim: { totalCents: 41_000, placeOfService: "11", frequencyCode: "1", diagnoses: [], attachments: [{ reportType: "RB", transmission: "FX", controlNumber: "CMD1A1" }] },
      lines: [
        { cdt: "D2392", chargeCents: 21_000, units: 1, dateOfService: "2026-09-01", tooth: "30", surfaces: "MO" },
        { cdt: "D4341", chargeCents: 20_000, units: 1, dateOfService: "2026-09-01", oralCavity: "10" },
      ],
    });
    expect(edi).toContain("GS*HC*S*R*20260925*1200*123*X*005010X224A2~");
    expect(edi).toContain("CLM*CMD1*410.00***11:B:1*Y*A*Y*Y~\nPWK*RB*FX***AC*CMD1A1~");
    expect(edi).toContain("SV3*AD:D2392*210.00****1~\nTOO*JP*30*M:O~\nDTP*472*D8*20260901~");
    expect(edi).toContain("SV3*AD:D4341*200.00**10**1~");
    expect(edi).not.toContain("HI*");
    const segments = edi.split("~").filter((x) => x.trim());
    const se = segments.find((x) => x.trim().startsWith("SE*"))!.trim().split("*");
    const st = segments.findIndex((x) => x.trim().startsWith("ST*"));
    expect(Number(se[1])).toBe(segments.findIndex((x) => x.trim().startsWith("SE*")) - st + 1);
  });
});

describe("dental claims, attachments and errors against a migrated database", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("creates a dental claim, attaches an x-ray, and sends an 837D with a PWK", async () => {
    const [seedClaim] = await t.db.select().from(schema.claims).where(eq(schema.claims.practiceId, t.practiceId)).limit(1);
    const [enc] = await t.db.select().from(schema.encounters).where(eq(schema.encounters.id, seedClaim.encounterId));
    const claim = await createDentalClaim(t.db, t.practiceId, {
      patientId: seedClaim.patientId, providerId: enc.providerId, dateOfService: "2026-09-01", diagnoses: [],
      lines: [{ cdt: "d2392", tooth: "30", surfaces: "mo", units: 1, chargeCents: 21_000 }, { cdt: "D4341", oralCavity: "10", units: 1, chargeCents: 20_000 }],
    }, t.userId);
    expect(claim).toMatchObject({ claimType: "dental", status: "ready", totalCents: 41_000 });

    const pdf = Buffer.from("%PDF-1.4 x-ray report");
    await expect(addAttachment(t.db, t.practiceId, claim.id, { name: "x.exe", type: "application/x-msdownload", bytes: pdf }, { reportType: "RB", transmission: "FX" })).rejects.toThrow(/PDF, JPEG/);
    const att = await addAttachment(t.db, t.practiceId, claim.id, { name: "bitewing.pdf", type: "application/pdf", bytes: pdf }, { reportType: "RB", transmission: "FX" }, t.userId);
    expect(att.controlNumber).toBe(`${claim.controlNumber}A1`);

    const preview = await previewClaimEdi(t.db, claim.id);
    expect(preview.filename).toBe(`${claim.controlNumber}-837D.x12`);
    expect(preview.edi).toContain(`PWK*RB*FX***AC*${att.controlNumber}~`);

    await submitClaim(t.db, claim.id, t.userId);
    const [sent] = await t.db.select().from(schema.claims).where(eq(schema.claims.id, claim.id));
    expect(sent.edi837).toContain("005010X224A2");
    expect(sent.edi837).toContain("TOO*JP*30*M:O~");
    const [listed] = await listAttachments(t.db, t.practiceId, claim.id);
    expect(listed.sentAt).toBeInstanceOf(Date);
    await expect(removeAttachment(t.db, t.practiceId, listed.id)).rejects.toThrow(/kept/);
  });

  it("groups repeated errors and reopens a resolved one when it happens again", async () => {
    const report = (id: string) => ({ message: `Claim ${id} not found for jane@example.com`, path: `/claims/${id}?q=Smith`, method: "GET", routePath: "/(app)/claims/[id]", routeType: "render" });
    const a = await recordError(t.db, report("0b7c6c1e-1111-4111-8111-111111111111"));
    const b = await recordError(t.db, report("0b7c6c1e-2222-4222-8222-222222222222"));
    expect(a).toBe(b);
    let [row] = (await listErrors(t.db)).filter((e) => e.fingerprint === a);
    expect(row).toMatchObject({ count: 2, path: "/claims/:id" });
    expect(row.message).not.toContain("jane@");
    await resolveError(t.db, a);
    expect((await listErrors(t.db)).some((e) => e.fingerprint === a)).toBe(false);
    await recordError(t.db, report("0b7c6c1e-3333-4333-8333-333333333333"));
    [row] = (await listErrors(t.db)).filter((e) => e.fingerprint === a);
    expect(row).toMatchObject({ count: 3, resolvedAt: null });
  });
});
