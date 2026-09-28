"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { startDemoSession } from "@/lib/auth";
import { DEMO_ACCOUNTS, type DemoRole } from "@/lib/demo";
import { clientIp } from "@/lib/ip";
import { hit } from "@/server/throttle";

/** Signs into the demo practice as the chosen role (lib/demo.ts), when the demo is open. */
export async function tryDemoAction(role: DemoRole): Promise<void> {
  if (!(role in DEMO_ACCOUNTS)) redirect("/demo");
  const db = await getDb();
  const t = await hit(db, "login", clientIp(await headers()));
  if (!t.ok) redirect("/demo?busy=1");
  const session = await startDemoSession(db, role);
  redirect(session ? "/dashboard" : "/demo");
}
