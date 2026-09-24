/**
 * Lab orders and results.
 *
 * An order is written as an HL7 ORM^O01, ready for the lab's interface. A
 * result arrives as an ORU^R01 on the same /api/hl7 endpoint as other HL7,
 * finds its order by our placer order number, and is refused if the patient
 * in the result is not the patient on the order. Abnormal results wait in a
 * review worklist until a clinician or biller marks them reviewed.
 *
 * Electronic ordering with Quest, Labcorp and others needs an account and an
 * interface agreement with each lab. Until one exists, orders are generated
 * but not transmitted, and a clearly labeled simulator can produce a result
 * for demonstration.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";
import { LABS, LAB_TESTS, abnormalFlag, rangeText, testByCode } from "@/lib/labs/catalog";
import { buildOrm, buildOru, parseOru } from "@/lib/hl7/lab";
import type { Hl7Message } from "@/lib/hl7/v2";

const { labOrders, labResults, patients, providers, patientInsurances, payers, practices } = schema;

export interface NewLabOrder {
  patientId: string;
  providerId: string;
  labCode: string;
  testCodes: string[];
  diagnoses: string[];
}

export async function createLabOrder(db: Db, practiceId: string, input: NewLabOrder, userId?: string) {
  const lab = LABS.find((l) => l.code === input.labCode);
  if (!lab) throw new Error("Choose a lab");
  const tests = [...new Set(input.testCodes)].map((c) => testByCode(c)).filter((t): t is NonNullable<typeof t> => !!t);
  if (!tests.length) throw new Error("Choose at least one test");
  const diagnoses = [...new Set(input.diagnoses.map((d) => d.replace(/\./g, "").trim().toUpperCase()).filter(Boolean))];
  if (!diagnoses.length) throw new Error("Add at least one diagnosis; the lab needs it to bill the patient's insurance");
  if (diagnoses.some((d) => !/^[A-Z]\d[0-9A-Z]{1,5}$/.test(d))) throw new Error("Diagnoses must be ICD-10-CM codes, e.g. E11.9");

  const [patient] = await db.select().from(patients).where(and(eq(patients.id, input.patientId), eq(patients.practiceId, practiceId))).limit(1);
  if (!patient) throw new Error("Patient not found");
  const [provider] = await db.select().from(providers).where(and(eq(providers.id, input.providerId), eq(providers.practiceId, practiceId))).limit(1);
  if (!provider) throw new Error("Choose the ordering provider");
  const [practice] = await db.select({ name: practices.name }).from(practices).where(eq(practices.id, practiceId)).limit(1);
  const [ins] = await db
    .select({ ins: patientInsurances, payer: payers })
    .from(patientInsurances)
    .innerJoin(payers, eq(payers.id, patientInsurances.payerId))
    .where(and(eq(patientInsurances.patientId, patient.id), eq(patientInsurances.active, true)))
    .orderBy(asc(patientInsurances.rank))
    .limit(1);

  const now = new Date();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(labOrders).where(eq(labOrders.practiceId, practiceId));
  const placerOrderNumber = `L${now.toISOString().slice(2, 10).replace(/-/g, "")}${String(Number(n) + 1).padStart(5, "0")}`;
  const ormMessage = buildOrm({
    controlId: `ORM${now.getTime()}`, now, receivingLab: lab.code, placerOrderNumber, facility: practice.name,
    patient: { mrn: patient.mrn, lastName: patient.lastName, firstName: patient.firstName, dob: patient.dob, sex: patient.sex },
    provider: { npi: provider.npi, lastName: provider.lastName, firstName: provider.firstName },
    insurance: ins ? { payerId: ins.payer.payerId, payerName: ins.payer.name, memberId: ins.ins.memberId, groupNumber: ins.ins.groupNumber } : null,
    diagnoses,
    tests: tests.map((t) => ({ code: t.code, name: t.name })),
  });
  const [order] = await db
    .insert(labOrders)
    .values({
      practiceId, patientId: patient.id, providerId: provider.id, labCode: lab.code, placerOrderNumber,
      tests: tests.map((t) => ({ code: t.code, name: t.name, cpt: t.cpt })), diagnoses, ormMessage, createdBy: userId ?? null,
    })
    .returning();
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "create_lab_order", entity: "lab_order", entityId: order.id, details: { lab: lab.code, tests: tests.map((t) => t.code) } });
  return order;
}

export async function listPatientOrders(db: Db, practiceId: string, patientId: string) {
  const orders = await db
    .select()
    .from(labOrders)
    .where(and(eq(labOrders.practiceId, practiceId), eq(labOrders.patientId, patientId)))
    .orderBy(desc(labOrders.createdAt))
    .limit(20);
  const results = orders.length ? await db.select().from(labResults).where(inArray(labResults.orderId, orders.map((o) => o.id))) : [];
  return orders.map((o) => ({ order: o, results: results.filter((r) => r.orderId === o.id) }));
}

export async function getLabOrder(db: Db, practiceId: string, id: string) {
  const [row] = await db
    .select({ order: labOrders, patient: patients, provider: providers })
    .from(labOrders)
    .innerJoin(patients, eq(patients.id, labOrders.patientId))
    .innerJoin(providers, eq(providers.id, labOrders.providerId))
    .where(and(eq(labOrders.id, id), eq(labOrders.practiceId, practiceId)))
    .limit(1);
  if (!row) return null;
  const results = await db.select().from(labResults).where(eq(labResults.orderId, id)).orderBy(asc(labResults.testCode), asc(labResults.name));
  return { ...row, results };
}

/** Orders still waiting on the lab, and resulted orders nobody has reviewed yet. */
export async function labWorklist(db: Db, practiceId: string) {
  const rows = await db
    .select({ order: labOrders, patient: patients })
    .from(labOrders)
    .innerJoin(patients, eq(patients.id, labOrders.patientId))
    .where(and(eq(labOrders.practiceId, practiceId), inArray(labOrders.status, ["ordered", "partial", "resulted"]), isNull(labOrders.reviewedAt)))
    .orderBy(desc(labOrders.createdAt))
    .limit(200);
  const results = rows.length ? await db.select().from(labResults).where(inArray(labResults.orderId, rows.map((r) => r.order.id))) : [];
  return rows.map((r) => {
    const mine = results.filter((x) => x.orderId === r.order.id);
    return { ...r, resultCount: mine.length, abnormal: mine.filter((x) => x.flag && x.flag !== "N").length };
  });
}

/**
 * Attaches an ORU^R01 to its order. A corrected result (OBX-11 = C) replaces
 * the earlier value for the same component. The order is resulted once every
 * ordered test has at least one observation, partial before that.
 */
export async function applyOru(db: Db, practiceId: string, msg: Hl7Message) {
  const oru = parseOru(msg);
  const [row] = await db
    .select({ order: labOrders, mrn: patients.mrn })
    .from(labOrders)
    .innerJoin(patients, eq(patients.id, labOrders.patientId))
    .where(and(eq(labOrders.practiceId, practiceId), eq(labOrders.placerOrderNumber, oru.placerOrderNumber)))
    .limit(1);
  if (!row) throw new Error(`No order ${oru.placerOrderNumber} in this practice`);
  if (row.order.status === "cancelled") throw new Error(`Order ${oru.placerOrderNumber} was cancelled`);
  if (oru.mrn && oru.mrn !== row.mrn) throw new Error(`The result's patient (MRN ${oru.mrn}) is not the patient on order ${oru.placerOrderNumber}`);

  for (const o of oru.observations) {
    if (o.status === "C") {
      await db.delete(labResults).where(and(eq(labResults.orderId, row.order.id), eq(labResults.loinc, o.loinc)));
    }
    await db.insert(labResults).values({
      orderId: row.order.id, practiceId, testCode: o.testCode || "", loinc: o.loinc, name: o.name || o.loinc, value: o.value,
      units: o.units || null, referenceRange: o.range || null, flag: o.flag || null, status: o.status, observedAt: o.observedAt || null,
    });
  }
  const have = new Set((await db.select({ code: labResults.testCode }).from(labResults).where(eq(labResults.orderId, row.order.id))).map((r) => r.code));
  const complete = row.order.tests.every((t) => have.has(t.code));
  const abnormal = oru.observations.filter((o) => o.flag && o.flag !== "N").length;
  await db
    .update(labOrders)
    .set({ status: complete ? "resulted" : "partial", fillerOrderNumber: oru.fillerOrderNumber || row.order.fillerOrderNumber, resultedAt: new Date(), reviewedAt: null, reviewedBy: null })
    .where(eq(labOrders.id, row.order.id));
  return {
    message: `${oru.observations.length} results for order ${oru.placerOrderNumber}${abnormal ? `, ${abnormal} abnormal` : ""}`,
    result: { orderId: row.order.id, observations: oru.observations.length, abnormal, status: complete ? "resulted" : "partial" },
  };
}

/** Deterministic pseudo-random values per order, so a demo result is stable. */
function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/**
 * DEMO ONLY: produces the ORU^R01 a lab would send for an order, with values
 * drawn around typical adult results, and processes it through the same path
 * as a real result. The message identifies the sender as a simulator.
 */
export async function simulateLabResult(db: Db, practiceId: string, orderId: string, userId?: string) {
  const found = await getLabOrder(db, practiceId, orderId);
  if (!found) throw new Error("Order not found");
  if (found.order.status === "cancelled") throw new Error("The order was cancelled");
  if (found.results.length) throw new Error("This order already has results");
  const rand = seeded(found.order.id);
  const normal = () => {
    const u = Math.max(rand(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  };
  const tests = found.order.tests.map((t) => {
    const def = LAB_TESTS.find((x) => x.code === t.code)!;
    return {
      code: def.code, name: def.name,
      observations: def.components.map((comp) => {
        const v = Math.max(0, comp.typical[0] + normal() * comp.typical[1]);
        const value = v.toFixed(comp.decimals);
        return { loinc: comp.loinc, name: comp.name, value, units: comp.units, range: rangeText(comp.low, comp.high), flag: abnormalFlag(Number(value), comp.low, comp.high) };
      }),
    };
  });
  const raw = buildOru({
    controlId: `SIM${Date.now()}`, now: new Date(), sendingLab: "SIMULATOR", placerOrderNumber: found.order.placerOrderNumber,
    fillerOrderNumber: `SIM-${found.order.placerOrderNumber}`,
    patient: { mrn: found.patient.mrn, lastName: found.patient.lastName, firstName: found.patient.firstName, dob: found.patient.dob, sex: found.patient.sex },
    tests,
  });
  const { processHl7 } = await import("./hl7");
  return processHl7(db, practiceId, raw, { source: "manual", userId });
}

export async function markLabReviewed(db: Db, practiceId: string, orderId: string, userId?: string) {
  await db
    .update(labOrders)
    .set({ reviewedAt: new Date(), reviewedBy: userId ?? null })
    .where(and(eq(labOrders.id, orderId), eq(labOrders.practiceId, practiceId), inArray(labOrders.status, ["resulted", "partial"])));
}

export async function cancelLabOrder(db: Db, practiceId: string, orderId: string, userId?: string) {
  await db.update(labOrders).set({ status: "cancelled" }).where(and(eq(labOrders.id, orderId), eq(labOrders.practiceId, practiceId), eq(labOrders.status, "ordered")));
  await db.insert(schema.auditLog).values({ practiceId, userId: userId ?? null, action: "cancel_lab_order", entity: "lab_order", entityId: orderId });
}
