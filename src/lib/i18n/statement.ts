/**
 * Patient statement text (the printed page and the letter mailed through
 * Lob), in the patient's preferred language. Service descriptions come from
 * the code sets and stay in English.
 *
 * The Spanish has not been reviewed by a certified translator; see ./patient.ts.
 */
import type { Lang } from "./patient";

const en = {
  patientStatement: "Patient statement",
  statement: "Statement",
  statementDate: "Statement date",
  account: "Account",
  statementFor: "Statement for",
  amountDue: "Amount due",
  payBy: (date: string) => `Please pay by ${date}`,
  summary: "Account summary",
  charges: "Charges for your visits",
  insurancePaid: "Paid by your insurance",
  adjustments: "Insurance adjustments and discounts",
  youPaid: "Payments you have made",
  balance: "Your balance",
  processed: "Your insurance has already processed the visits below. The balance is your share under your plan, such as a deductible, copay or coinsurance.",
  visitDetail: "Visit detail",
  visit: "Visit",
  services: "Services",
  chargesCol: "Charges",
  insurancePaidCol: "Insurance paid",
  adjustedCol: "Adjusted",
  youOwe: "You owe",
  unapplied: (amount: string) => `Payments on account of ${amount} have been applied. `,
  discounts: (amount: string) => `Discounts of ${amount} have been applied.`,
  moreVisits: (n: number) => `and ${n} earlier visit${n === 1 ? "" : "s"}; call us for the full list`,
  howToPay: "How to pay",
  byPhone: (phone: string) => `By phone: call ${phone} with your account number.`,
  byMail: (name: string) => `By mail: send a check payable to ${name} with the stub below.`,
  inPerson: "In person: at your next visit, at the front desk.",
  needHelp: "Need help paying?",
  help: "If you cannot pay the full amount, call us before the due date. We can set up a payment plan, and you may qualify for a financial hardship discount.",
  returnStub: "Please return this portion with your payment",
  patient: "Patient",
  enclosed: "Amount enclosed",
  due: (date: string) => `Due ${date}`,
  letterHowToPay: (phone: string, name: string, mrn: string) => `<b>How to pay:</b> call ${phone}, use the payment link we sent by text or email, or mail a check payable to ${name} with your account number ${mrn}.`,
  letterHelp: (phone: string) => `If you cannot pay the full amount, call us about a payment plan or financial assistance. Questions about this bill: ${phone}.`,
  ourOffice: "our office",
  callOffice: "call our office",
};

export type StatementText = typeof en;

const es: StatementText = {
  patientStatement: "Estado de cuenta del paciente",
  statement: "Estado de cuenta",
  statementDate: "Fecha del estado de cuenta",
  account: "Cuenta",
  statementFor: "Estado de cuenta de",
  amountDue: "Monto a pagar",
  payBy: (date) => `Pague a más tardar el ${date}`,
  summary: "Resumen de la cuenta",
  charges: "Cargos por sus citas",
  insurancePaid: "Pagado por su seguro",
  adjustments: "Ajustes del seguro y descuentos",
  youPaid: "Pagos que usted ha hecho",
  balance: "Su saldo",
  processed: "Su seguro ya procesó las citas de abajo. El saldo es la parte que le corresponde según su plan, como un deducible, copago o coseguro.",
  visitDetail: "Detalle de las citas",
  visit: "Cita",
  services: "Servicios",
  chargesCol: "Cargos",
  insurancePaidCol: "Pagado por el seguro",
  adjustedCol: "Ajustado",
  youOwe: "Usted debe",
  unapplied: (amount) => `Se aplicaron pagos a cuenta por ${amount}. `,
  discounts: (amount) => `Se aplicaron descuentos por ${amount}.`,
  moreVisits: (n) => `y ${n} ${n === 1 ? "cita anterior" : "citas anteriores"}; llámenos para ver la lista completa`,
  howToPay: "Cómo pagar",
  byPhone: (phone) => `Por teléfono: llame al ${phone} con su número de cuenta.`,
  byMail: (name) => `Por correo: envíe un cheque a nombre de ${name} con el talón de abajo.`,
  inPerson: "En persona: en su próxima cita, en la recepción.",
  needHelp: "¿Necesita ayuda para pagar?",
  help: "Si no puede pagar el monto completo, llámenos antes de la fecha de vencimiento. Podemos hacer un plan de pagos, y usted podría calificar para un descuento por dificultades económicas.",
  returnStub: "Devuelva esta parte con su pago",
  patient: "Paciente",
  enclosed: "Monto adjunto",
  due: (date) => `Vence el ${date}`,
  letterHowToPay: (phone, name, mrn) => `<b>Cómo pagar:</b> llame al ${phone}, use el enlace de pago que le enviamos por mensaje de texto o correo electrónico, o envíe por correo un cheque a nombre de ${name} con su número de cuenta ${mrn}.`,
  letterHelp: (phone) => `Si no puede pagar el monto completo, llámenos para hablar de un plan de pagos o de asistencia financiera. Preguntas sobre esta factura: ${phone}.`,
  ourOffice: "nuestra oficina",
  callOffice: "llame a nuestra oficina",
};

export const STATEMENT_TEXT: Record<Lang, StatementText> = { en, es };

/** A statement date ("2026-10-06") as "Oct 6, 2026" or "6 oct 2026". */
export function statementDay(lang: Lang, iso: string | null) {
  return iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "";
}
