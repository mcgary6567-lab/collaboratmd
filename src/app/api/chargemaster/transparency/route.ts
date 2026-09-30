import { getDb } from "@/db";
import { getSession } from "@/lib/auth";
import { priceTransparencyCsv } from "@/server/chargemaster";

export const dynamic = "force-dynamic";

/** The standard charges file from the chargemaster (prices only, no patient data). Administrators and billers. */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  if (!["admin", "biller"].includes(session.role)) return new Response("The standard charges file is for billers and administrators", { status: 403 });
  const q = new URL(req.url).searchParams;
  const info = { locationName: (q.get("location") ?? "").slice(0, 120), licenseNumber: (q.get("license") ?? "").slice(0, 40), licenseState: (q.get("state") ?? "").slice(0, 2).toUpperCase() };
  if (!info.locationName || !info.licenseNumber || !/^[A-Z]{2}$/.test(info.licenseState)) return new Response("Give the location name, license number and state", { status: 400 });
  const csv = await priceTransparencyCsv(await getDb(), session.practiceId, info);
  return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="standard-charges.csv"` } });
}
