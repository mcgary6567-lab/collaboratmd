"use client";

import { useActionState } from "react";
import { CheckCircle2, Send } from "lucide-react";
import { contactAction, type ContactState } from "./actions";

const TOPICS = [
  { value: "sales", label: "Sales and pricing" },
  { value: "support", label: "Product support" },
  { value: "privacy", label: "Privacy and data requests" },
  { value: "security", label: "Security disclosure" },
  { value: "press", label: "Press and partnerships" },
];

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="mt-1.5 block text-xs font-medium text-red-600">{message}</span>;
}

export function ContactForm() {
  const [state, action, pending] = useActionState<ContactState | undefined, FormData>(
    contactAction,
    undefined,
  );

  if (state?.ok) {
    return (
      <div className="rounded-2xl border border-green-200 bg-green-50 p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-green-600" />
        <h3 className="mt-4 text-lg font-bold text-slate-900">Thank you, we have your message</h3>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-700">
          It has been recorded and routed to the queue for the topic you selected. We reply to every
          message, and the response times on this page are the ones we hold ourselves to.
        </p>
        {state.reference && (
          <p className="mt-5 text-sm text-slate-600">
            Your reference is{" "}
            <span className="rounded-md bg-white px-2 py-1 font-mono font-semibold text-slate-900 ring-1 ring-green-200">
              {state.reference}
            </span>
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      {state?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {state.error}
        </div>
      )}

      <div aria-hidden className="absolute left-[-9999px] h-px w-px overflow-hidden">
        <label>
          Company website
          <input name="company_website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="label">Full name</span>
          <input name="name" className="input" autoComplete="name" defaultValue={state?.values?.name} required />
          <FieldError message={state?.fieldErrors?.name} />
        </label>
        <label className="block">
          <span className="label">Work email</span>
          <input name="email" type="email" className="input" autoComplete="email" defaultValue={state?.values?.email} required />
          <FieldError message={state?.fieldErrors?.email} />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <span className="label">Practice or company</span>
          <input name="organization" className="input" autoComplete="organization" defaultValue={state?.values?.organization} />
        </label>
        <label className="block">
          <span className="label">Topic</span>
          <select name="topic" className="select" defaultValue={state?.values?.topic ?? "sales"}>
            {TOPICS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block">
        <span className="label">How can we help?</span>
        <textarea name="message" className="textarea" rows={6} defaultValue={state?.values?.message} required />
        <FieldError message={state?.fieldErrors?.message} />
      </label>

      <button
        className="btn w-full justify-center bg-green-600 py-3 text-white hover:bg-green-700 sm:w-auto sm:px-7"
        disabled={pending}
      >
        {pending ? "Sending..." : <>Send message <Send className="h-4 w-4" /></>}
      </button>

      <p className="text-xs leading-relaxed text-slate-500">
        By sending this form you agree to our <a href="/terms" className="font-medium text-green-700 underline underline-offset-2">Terms &amp; Conditions</a> and{" "}
        <a href="/privacy" className="font-medium text-green-700 underline underline-offset-2">Privacy Policy</a>. Do not include patient
        information in your message.
      </p>
    </form>
  );
}
