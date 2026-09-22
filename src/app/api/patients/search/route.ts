import { NextResponse } from "next/server";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Patient typeahead.
 *
 * The practice has tens of thousands of patients, so selection widgets query
 * this instead of embedding the whole roster in the page.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  const db = await getDb();
  const { patients } = schema;

  const where = q
    ? and(
        eq(patients.practiceId, session.practiceId),
        or(
          ilike(patients.lastName, `${q}%`),
          ilike(patients.firstName, `${q}%`),
          ilike(patients.mrn, `${q}%`),
          // "last, first" and "first last" both work
          sql`lower(${patients.lastName} || ', ' || ${patients.firstName}) LIKE lower(${q + "%"})`,
        ),
      )
    : eq(patients.practiceId, session.practiceId);

  const rows = await db
    .select({
      id: patients.id,
      mrn: patients.mrn,
      firstName: patients.firstName,
      lastName: patients.lastName,
      dob: patients.dob,
    })
    .from(patients)
    .where(where)
    .orderBy(patients.lastName, patients.firstName)
    .limit(20);

  return NextResponse.json(
    rows.map((p) => ({
      id: p.id,
      label: `${p.lastName}, ${p.firstName}`,
      mrn: p.mrn,
      dob: p.dob,
    })),
  );
}
