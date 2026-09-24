"use client";

import { useState } from "react";

/** "Same card as on file" or the details of a new one. Only the last four of the member ID on file are shown. */
export function InsuranceFields({ onFile }: { onFile: { payerName: string; memberEnding: string } | null }) {
  const [choice, setChoice] = useState<"same" | "new">(onFile ? "same" : "new");
  return (
    <div className="space-y-3 text-sm">
      {onFile && (
        <label className="flex gap-2">
          <input type="radio" name="insuranceChoice" value="same" checked={choice === "same"} onChange={() => setChoice("same")} className="mt-1" />
          <span>My insurance has not changed: <span className="font-medium">{onFile.payerName}</span>, member ID ending {onFile.memberEnding}</span>
        </label>
      )}
      <label className="flex gap-2">
        <input type="radio" name="insuranceChoice" value="new" checked={choice === "new"} onChange={() => setChoice("new")} className="mt-1" />
        <span>{onFile ? "I have a new insurance card" : "Add my insurance"}</span>
      </label>
      {choice === "new" && (
        <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
          <div className="col-span-2"><label className="label" htmlFor="payerName">Insurance company</label><input id="payerName" name="payerName" className="input" required /></div>
          <div><label className="label" htmlFor="memberId">Member ID</label><input id="memberId" name="memberId" className="input" required /></div>
          <div><label className="label" htmlFor="groupNumber">Group number</label><input id="groupNumber" name="groupNumber" className="input" /></div>
          <div className="col-span-2">
            <label className="label" htmlFor="relationship">The patient is the policyholder&apos;s</label>
            <select id="relationship" name="relationship" className="input" defaultValue="self">
              <option value="self">Self (the patient is the policyholder)</option>
              <option value="spouse">Spouse</option>
              <option value="child">Child</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
