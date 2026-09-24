import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export const dynamic = "force-dynamic";

/**
 * Liveness for uptime monitors. It is public, so it says only whether the
 * database answers: no counts, and no error text that could describe the
 * infrastructure.
 */
export async function GET() {
  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    return NextResponse.json({ ok: true, time: new Date().toISOString() });
  } catch (err) {
    console.error("[collaboratmd] health check failed", err);
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
