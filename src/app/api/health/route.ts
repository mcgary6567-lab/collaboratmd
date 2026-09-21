import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const result = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM claims`);
    return NextResponse.json({ ok: true, database: process.env.DATABASE_URL ? "postgres" : "pglite", claims: result.rows[0]?.n ?? 0, time: new Date().toISOString() });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
