"use client";

import { useState } from "react";

export type InsuranceText = { same: string; memberEnding: string; newCard: string; add: string; company: string; memberId: string; group: string; relationship: string; self: string; spouse: string; child: string; other: string };

/** "Same card as on file" or the details of a new one. Only the last four of the member ID on file are shown. */
export function InsuranceFields({ onFile, text: t }: { onFile: { payerName: string; memberEnding: string } | null; text: InsuranceText }) {
  const [choice, setChoice] = useState<"same" | "new">(onFile ? "same" : "new");
  return (
    <div className="space-y-3 text-sm">
      {onFile && (
        <label className="flex gap-2">
          <input type="radio" name="insuranceChoice" value="same" checked={choice === "same"} onChange={() => setChoice("same")} className="mt-1" />
          <span>{t.same} <span className="font-medium">{onFile.payerName}</span>, {t.memberEnding}</span>
        </label>
      )}
      <label className="flex gap-2">
        <input type="radio" name="insuranceChoice" value="new" checked={choice === "new"} onChange={() => setChoice("new")} className="mt-1" />
        <span>{onFile ? t.newCard : t.add}</span>
      </label>
      {choice === "new" && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
          <div className="col-span-2"><label className="label" htmlFor="payerName">{t.company}</label><input id="payerName" name="payerName" className="input" required /></div>
          <div><label className="label" htmlFor="memberId">{t.memberId}</label><input id="memberId" name="memberId" className="input" required /></div>
          <div><label className="label" htmlFor="groupNumber">{t.group}</label><input id="groupNumber" name="groupNumber" className="input" /></div>
          <div className="col-span-2">
            <label className="label" htmlFor="relationship">{t.relationship}</label>
            <select id="relationship" name="relationship" className="input" defaultValue="self">
              <option value="self">{t.self}</option>
              <option value="spouse">{t.spouse}</option>
              <option value="child">{t.child}</option>
              <option value="other">{t.other}</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
