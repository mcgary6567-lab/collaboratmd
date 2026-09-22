"use client";

import { useActionState } from "react";
import { createAppointmentAction } from "@/app/(app)/actions";
import { Field, Alert } from "@/components/ui";
import { PatientPicker } from "@/components/patient-picker";

export function AppointmentForm({ date, providers }: { date: string; providers: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createAppointmentAction, undefined);
  return (
    <form action={action} className="space-y-3">
      {state && <Alert kind={state.ok ? "success" : "error"}>{state.message}</Alert>}
      <Field label="Patient">
        <PatientPicker name="patientId" />
      </Field>
      <Field label="Provider">
        <select name="providerId" className="select" required>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </Field>
      <Field label="Start"><input name="startsAt" type="datetime-local" className="input" defaultValue={`${date}T09:00`} required /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Minutes"><input name="minutes" type="number" className="input" defaultValue={30} min={5} step={5} /></Field>
        <Field label="Type">
          <select name="type" className="select">
            <option value="office_visit">Office visit</option>
            <option value="follow_up">Follow-up</option>
            <option value="annual_physical">Annual physical</option>
            <option value="telehealth">Telehealth</option>
            <option value="procedure">Procedure</option>
          </select>
        </Field>
      </div>
      <Field label="Reason"><input name="reason" className="input" /></Field>
      <button className="btn btn-primary w-full justify-center" disabled={pending}>{pending ? "Booking..." : "Book"}</button>
    </form>
  );
}
