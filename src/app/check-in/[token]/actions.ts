"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db";
import type { FormResult } from "@/components/action-form";
import { endCheckin, grantCheckin, verifiedFor } from "@/lib/checkin-session";
import { openLink, submitCheckin, verifyDob } from "@/server/checkin";

export async function verifyDobAction(token: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const db = await getDb();
  const r = await verifyDob(db, token, String(formData.get("dob") ?? ""));
  if (!r.ok) return { ok: false, message: r.message };
  await grantCheckin(r.linkId);
  redirect(`/check-in/${token}`);
}

export async function submitCheckinAction(token: string, _prev: FormResult, formData: FormData): Promise<FormResult> {
  const db = await getDb();
  const opened = await openLink(db, token);
  if (opened.state !== "open" || !(await verifiedFor(opened.link.id))) {
    return { ok: false, message: "Your session has ended. Reload the page and confirm your date of birth again." };
  }
  const f = (k: string) => String(formData.get(k) ?? "");
  try {
    await submitCheckin(db, opened.link.id, {
      demographics: { phone: f("phone"), email: f("email"), address1: f("address1"), city: f("city"), state: f("state"), zip: f("zip") },
      insurance: {
        sameAsOnFile: f("insuranceChoice") !== "new",
        payerName: f("payerName"), memberId: f("memberId"), groupNumber: f("groupNumber"), relationship: f("relationship"),
      },
      consents: {
        privacyNotice: formData.get("privacyNotice") === "on",
        financialPolicy: formData.get("financialPolicy") === "on",
        assignmentOfBenefits: formData.get("assignmentOfBenefits") === "on",
        signature: f("signature"),
      },
    });
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Something went wrong" };
  }
  await endCheckin();
  redirect(`/check-in/${token}`);
}
