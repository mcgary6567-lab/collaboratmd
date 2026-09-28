"use server";

import { requireSession } from "@/lib/auth";
import { lookupNpi, type NpiRecord } from "@/lib/nppes";

export async function lookupNpiAction(npi: string): Promise<{ ok: true; record: NpiRecord } | { ok: false; message: string }> {
  await requireSession();
  try {
    const record = await lookupNpi(String(npi ?? ""));
    return record ? { ok: true, record } : { ok: false, message: "No provider or organization has that NPI in the NPI Registry" };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Lookup failed" };
  }
}
