import type { yearReceipt } from "@/server/receipts";
import { money } from "@/lib/utils";

type Receipt = Awaited<ReturnType<typeof yearReceipt>>;
type Party = { name: string; address1?: string | null; city?: string | null; state?: string | null; zip?: string | null; phone?: string | null; taxId?: string | null };

const TEXT = {
  en: {
    title: (y: number) => `Payment receipt for ${y}`, for: "Patient", account: "Account", paidOn: "Paid on", visit: "Visit", amount: "Amount",
    payments: "Payments", refunds: "Refunds to you", total: "Total paid", refunded: "Less refunds", net: "Net paid in the year", none: "No payments in this year.",
    note: "Keep this receipt for your health savings account, flexible spending account or tax records. It lists payments received, not charges or insurance payments.",
    taxId: "Tax ID", visitOf: (d: string | null) => (d ? `Visit ${d}` : "Account payment"),
  },
  es: {
    title: (y: number) => `Recibo de pagos de ${y}`, for: "Paciente", account: "Cuenta", paidOn: "Fecha de pago", visit: "Visita", amount: "Monto",
    payments: "Pagos", refunds: "Reembolsos a usted", total: "Total pagado", refunded: "Menos reembolsos", net: "Pago neto del año", none: "No hay pagos en este año.",
    note: "Guarde este recibo para su cuenta de ahorros para la salud, cuenta de gastos flexibles o registros de impuestos. Muestra los pagos recibidos, no los cargos ni los pagos del seguro.",
    taxId: "Número de identificación fiscal", visitOf: (d: string | null) => (d ? `Visita ${d}` : "Pago a la cuenta"),
  },
};

/** One patient's year of payments, laid out to print on its own page. */
export function PaymentReceipt({ receipt, practice, patient, lang = "en" }: { receipt: Receipt; practice: Party; patient: { firstName: string; lastName: string; mrn: string } & Partial<Party>; lang?: "en" | "es" }) {
  const t = TEXT[lang];
  const row = (l: Receipt["payments"][number]) => (
    <tr key={`${l.postedOn}-${l.amountCents}-${l.controlNumber}`}>
      <td className="py-1 pr-3">{l.postedOn}</td>
      <td className="py-1 pr-3">{t.visitOf(l.dateOfService)}{l.controlNumber ? ` (${l.controlNumber})` : ""}</td>
      <td className="py-1 text-right tabular-nums">{money(l.amountCents)}</td>
    </tr>
  );
  return (
    <section className="print-page-break mx-auto max-w-3xl rounded-lg border border-slate-200 bg-white p-8 text-sm text-slate-900">
      <div className="flex flex-wrap justify-between gap-4">
        <div>
          <div className="text-lg font-bold">{practice.name}</div>
          <div>{practice.address1}</div>
          <div>{[practice.city, practice.state].filter(Boolean).join(", ")} {practice.zip}</div>
          {practice.phone && <div>{practice.phone}</div>}
          {practice.taxId && <div className="text-xs text-slate-600">{t.taxId}: {practice.taxId}</div>}
        </div>
        <div className="text-right">
          <h1 className="text-xl font-bold">{t.title(receipt.year)}</h1>
          <div>{t.for}: {patient.firstName} {patient.lastName}</div>
          <div className="text-xs text-slate-600">{t.account}: {patient.mrn}</div>
        </div>
      </div>
      {receipt.payments.length === 0 ? <p className="mt-6">{t.none}</p> : (
        <>
          <h2 className="mt-6 font-semibold">{t.payments}</h2>
          <table className="mt-1 w-full"><thead><tr className="border-b text-left text-xs uppercase text-slate-500"><th className="py-1 pr-3">{t.paidOn}</th><th className="py-1 pr-3">{t.visit}</th><th className="py-1 text-right">{t.amount}</th></tr></thead>
            <tbody>{receipt.payments.map(row)}</tbody></table>
          {receipt.refunds.length > 0 && (
            <>
              <h2 className="mt-4 font-semibold">{t.refunds}</h2>
              <table className="mt-1 w-full"><tbody>{receipt.refunds.map(row)}</tbody></table>
            </>
          )}
          <table className="mt-4 ml-auto w-72">
            <tbody>
              <tr><td className="py-0.5">{t.total}</td><td className="text-right tabular-nums">{money(receipt.paidCents)}</td></tr>
              {receipt.refundedCents > 0 && <tr><td className="py-0.5">{t.refunded}</td><td className="text-right tabular-nums">-{money(receipt.refundedCents)}</td></tr>}
              <tr className="border-t font-semibold"><td className="py-0.5">{t.net}</td><td className="text-right tabular-nums">{money(receipt.netCents)}</td></tr>
            </tbody>
          </table>
        </>
      )}
      <p className="mt-6 text-xs text-slate-600">{t.note}</p>
    </section>
  );
}
