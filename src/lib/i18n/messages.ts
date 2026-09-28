/**
 * Texts and emails to patients, in the patient's preferred language.
 * Appointment times are clock times stored as UTC (see server/booking.ts), so
 * they are formatted in UTC.
 *
 * The collections final notice is not here: it stays in English until a
 * translation has been reviewed by counsel, as it is a legal notice.
 * The Spanish has not been reviewed by a certified translator; see ./patient.ts.
 */
import type { Lang } from "./patient";

type Msg = { sms: string; email: { subject: string; text: string } };
type Practice = { name: string; phone?: string | null };

export const langOf = (v: string | null | undefined): Lang => (v === "es" ? "es" : "en");

const LOCALE = { en: "en-US", es: "es-US" } as const;

/** "Tuesday, October 6 at 9:00 AM" / "martes, 6 de octubre, 9:00 a. m." */
export function visitTime(lang: Lang, d: Date) {
  const date = d.toLocaleString(LOCALE[lang], { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
  const time = d.toLocaleString(LOCALE[lang], { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  return lang === "es" ? `${date}, ${time}` : `${date} at ${time}`;
}
export function shortDate(lang: Lang, d: Date) {
  return d.toLocaleDateString(LOCALE[lang], { month: "short", day: "numeric", timeZone: "UTC" });
}

export function appointmentReminder(lang: Lang, p: Practice, firstName: string, when: string, url: string): Msg {
  if (lang === "es") return {
    sms: `${p.name}: le recordamos su cita del ${when}. Regístrese en línea: ${url} . Responda C para confirmar o X para cancelar. Responda STOP para no recibir más mensajes.`,
    email: { subject: `Su cita con ${p.name}`, text: `Hola, ${firstName}:\n\nLe recordamos su cita del ${when}.\n\nAhorre tiempo registrándose en línea:\n${url}\n\n${p.name}${p.phone ? `\n${p.phone}` : ""}` },
  };
  return {
    sms: `${p.name}: reminder of your appointment ${when}. Check in online: ${url} . Reply C to confirm or X to cancel. Reply STOP to opt out.`,
    email: { subject: `Your appointment with ${p.name}`, text: `Hi ${firstName},\n\nThis is a reminder of your appointment on ${when}.\n\nSave time by checking in online:\n${url}\n\n${p.name}${p.phone ? `\n${p.phone}` : ""}` },
  };
}

export function bookingConfirmed(lang: Lang, p: Practice, when: string): Msg {
  if (lang === "es") return {
    sms: `${p.name}: su cita está confirmada para el ${when}. Llame al ${p.phone ?? "consultorio"} para cambiarla. Responda STOP para no recibir más mensajes.`,
    email: { subject: `Su cita con ${p.name}`, text: `Su cita está confirmada para el ${when}.\n\nPara cambiarla o cancelarla, llame al ${p.phone ?? "consultorio"}.\n\n${p.name}` },
  };
  return {
    sms: `${p.name}: your appointment is confirmed for ${when}. Call ${p.phone ?? "us"} to change it. Reply STOP to opt out.`,
    email: { subject: `Your appointment with ${p.name}`, text: `Your appointment is confirmed for ${when}.\n\nTo change or cancel it, call ${p.phone ?? "the office"}.\n\n${p.name}` },
  };
}

export function payLink(lang: Lang, p: Practice, firstName: string, amount: string, url: string): Msg {
  if (lang === "es") return {
    sms: `${p.name}: su saldo es de ${amount}. Pague de forma segura con tarjeta: ${url} . Responda STOP para no recibir más mensajes.`,
    email: { subject: `Pague su saldo con ${p.name}`, text: `Hola, ${firstName}:\n\nSu saldo con ${p.name} es de ${amount}. Aquí puede ver a qué corresponde y pagar de forma segura con tarjeta:\n\n${url}\n\nEl enlace le pedirá su fecha de nacimiento y funciona durante 30 días.\n\n${p.name}` },
  };
  return {
    sms: `${p.name}: your balance is ${amount}. Pay securely by card: ${url} . Reply STOP to opt out.`,
    email: { subject: `Pay your balance with ${p.name}`, text: `Hi ${firstName},\n\nYour balance with ${p.name} is ${amount}. You can see what it is for and pay securely by card here:\n\n${url}\n\nThe link asks for your date of birth and works for 30 days.\n\n${p.name}` },
  };
}

export function balanceReminder(lang: Lang, p: Practice, firstName: string, amount: string, url: string): Msg {
  if (lang === "es") return {
    sms: `${p.name}: tiene un saldo de ${amount}. Véalo y pague de forma segura: ${url} . Responda STOP para no recibir más mensajes.`,
    email: { subject: `Su saldo con ${p.name}`, text: `Hola, ${firstName}:\n\nSu saldo con ${p.name} es de ${amount}. Aquí puede ver a qué corresponde y pagar de forma segura:\n\n${url}\n\nSi desea un plan de pagos, responda a este correo o llame a la oficina${p.phone ? ` al ${p.phone}` : ""}.\n\n${p.name}` },
  };
  return {
    sms: `${p.name}: you have a balance of ${amount}. View and pay securely: ${url} . Reply STOP to opt out.`,
    email: { subject: `Your balance with ${p.name}`, text: `Hi ${firstName},\n\nYour balance with ${p.name} is ${amount}. You can see what it is for and pay securely here:\n\n${url}\n\nIf you would like a payment plan, reply to this email or call the office${p.phone ? ` at ${p.phone}` : ""}.\n\n${p.name}` },
  };
}

export function depositRequest(lang: Lang, p: Practice, firstName: string, when: string, amount: string, url: string): Msg {
  if (lang === "es") return {
    sms: `${p.name}: el costo estimado de su cita del ${when} es ${amount}. Vea el estimado y pague por adelantado en ${url} . Responda STOP para no recibir más mensajes.`,
    email: { subject: `Costo estimado de su cita del ${when}`, text: `Hola, ${firstName}:\n\nSegún su seguro, el costo estimado de su cita del ${when} es ${amount}. Es un estimado; su factura final depende de la atención que reciba.\n\nPuede pagarlo por adelantado aquí:\n\n${url}\n\n${p.name}` },
  };
  return {
    sms: `${p.name}: your estimated cost for your visit on ${when} is ${amount}. See the estimate and pay ahead at ${url} . Reply STOP to opt out.`,
    email: { subject: `Your estimated cost for your visit on ${when}`, text: `Hi ${firstName},\n\nBased on your insurance, your estimated cost for your visit on ${when} is ${amount}. This is an estimate; your final bill depends on the care you receive.\n\nYou can pay it ahead of time here:\n\n${url}\n\n${p.name}` },
  };
}

export function portalLink(lang: Lang, p: Practice, firstName: string, purpose: "portal" | "pay", url: string): Msg {
  if (lang === "es") {
    const what = purpose === "pay" ? "ver y pagar su saldo" : "ver su cuenta, estados de cuenta y pagos";
    return {
      sms: `${p.name}: puede ${what} en ${url} . Responda STOP para no recibir más mensajes.`,
      email: { subject: `Su cuenta con ${p.name}`, text: `Hola, ${firstName}:\n\nPuede ${what} aquí:\n\n${url}\n\nEl enlace le pedirá su fecha de nacimiento y funciona durante 30 días.\n\n${p.name}` },
    };
  }
  const what = purpose === "pay" ? "view and pay your balance" : "see your account, statements and payments";
  return {
    sms: `${p.name}: ${what} at ${url} . Reply STOP to opt out.`,
    email: { subject: `Your account with ${p.name}`, text: `Hi ${firstName},\n\nYou can ${what} here:\n\n${url}\n\nThe link asks for your date of birth and works for 30 days.\n\n${p.name}` },
  };
}

/** Replies to a patient's C (confirm) or X (cancel) text. "CANCEL" itself is a carrier opt-out word, so X is used. */
export function replyConfirmed(lang: Lang, p: Practice, when: string) {
  return lang === "es"
    ? `${p.name}: gracias, su cita del ${when} está confirmada.`
    : `${p.name}: thank you, your appointment ${when} is confirmed.`;
}
export function replyCancelled(lang: Lang, p: Practice, when: string) {
  return lang === "es"
    ? `${p.name}: cancelamos su cita del ${when}. Para hacer otra, llame al ${p.phone ?? "consultorio"}.`
    : `${p.name}: your appointment ${when} is cancelled. To book another, call ${p.phone ?? "the office"}.`;
}
