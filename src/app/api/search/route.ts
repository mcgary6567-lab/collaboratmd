import { NextResponse } from "next/server";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** % and _ are wildcards in LIKE; a search for "50%" must not match everything. */
const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Search palette: patients by name or MRN, claims by our control number or
 * the payer's claim number, all within the signed-in practice.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (q.length < 2) return NextResponse.json([]);
  const db = await getDb();
  const { patients, claims } = schema;
  const p = `${escapeLike(q)}%`;

  const [pts, cls] = await Promise.all([
    db
      .select({ id: patients.id, first: patients.firstName, last: patients.lastName, mrn: patients.mrn, dob: patients.dob })
      .from(patients)
      .where(and(eq(patients.practiceId, session.practiceId), or(
        ilike(patients.lastName, p), ilike(patients.firstName, p), ilike(patients.mrn, p),
        sql`lower(${patients.lastName} || ', ' || ${patients.firstName}) LIKE lower(${p})`,
        sql`lower(${patients.firstName} || ' ' || ${patients.lastName}) LIKE lower(${p})`,
      )))
      .orderBy(patients.lastName, patients.firstName)
      .limit(6),
    db
      .select({ id: claims.id, control: claims.controlNumber, status: claims.status, total: claims.totalCents })
      .from(claims)
      .where(and(eq(claims.practiceId, session.practiceId), or(ilike(claims.controlNumber, p), ilike(claims.payerClaimNumber, p))))
      .limit(6),
  ]);

  return NextResponse.json([
    ...pts.map((x) => ({ kind: "patient", label: `${x.last}, ${x.first}`, detail: `${x.mrn} · DOB ${x.dob}`, href: `/patients/${x.id}` })),
    ...cls.map((x) => ({ kind: "claim", label: x.control, detail: `${x.status.replace(/_/g, " ")} · $${(x.total / 100).toFixed(2)}`, href: `/claims/${x.id}` })),
  ]);
}
