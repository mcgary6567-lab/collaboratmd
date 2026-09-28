/** When something last ran, by name ("tick", "daily"): see server/tick.ts and the status page. */
import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { schema } from "@/db";

const { heartbeats } = schema;

export async function beat(db: Db, name: string, at = new Date()) {
  await db.insert(heartbeats).values({ name, at }).onConflictDoUpdate({ target: heartbeats.name, set: { at } });
}

export async function lastBeat(db: Db, name: string) {
  const [h] = await db.select().from(heartbeats).where(eq(heartbeats.name, name)).limit(1);
  return h?.at ?? null;
}
