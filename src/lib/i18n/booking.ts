/**
 * Text for the public booking page, in English and Spanish, following the
 * patient's language choice (the same cookie as check-in and the portal).
 *
 * The Spanish was written for this product and has not been reviewed by a
 * certified translator; see the note in ./patient.ts.
 */
import type { Lang } from "./patient";

const en = {
  switchTo: "Español",
  title: "Online booking",
  request: "Request an appointment",
  notAvailable: (phone: string | null) => `Online booking is not available for this practice. Please call the office${phone ? ` at ${phone}` : ""}.`,
  noTimes: (phone: string | null) => `No open times right now. Please call the office${phone ? ` at ${phone}` : ""}.`,
  pickAnother: "Pick another time",
  anyProvider: "Any provider",
  provider: "Provider",
  when: (date: string, time: string) => `${date} at ${time}`,
  timesNote: (city: string) => `Times are ${city} time. Your request is confirmed by the office.`,
  firstName: "First name",
  lastName: "Last name",
  dob: "Date of birth",
  mobile: "Mobile phone",
  email: "Email",
  payer: "Insurance company (optional)",
  memberId: "Member ID (optional)",
  reason: "Reason for the visit (optional)",
  smsConsent: "Text me about this appointment. Message and data rates may apply; reply STOP to stop.",
  sending: "Sending...",
  requestWhen: (when: string) => `Request ${when}`,
  contactNote: "Give a phone number or an email so the office can confirm. For an emergency, call 911.",
  sentFor: (when: string) => `Request sent for ${when}`,
  sentNote: "The office will confirm it by phone, text or email. It is not booked until they do.",
  waitlistTitle: "No time that suits?",
  waitlistIntro: "Join the waitlist. When an earlier time opens, we text it to the people waiting; the first to reply gets it.",
  anyTime: "Any time",
  mornings: "Mornings (before noon)",
  afternoons: "Afternoons (from noon)",
  hours: "When you can come",
  waitlistConsent: "Text me when a time opens. Message and data rates may apply; reply STOP to stop.",
  waitlistNeedsText: "Openings are offered by text only, so leave this unticked only if you would rather the office call you.",
  joinWaitlist: "Ask to join the waitlist",
  waitlistSent: "Request sent",
  waitlistSentNote: "The office will confirm it. You are not on the waitlist until they do.",
};

export type BookingText = typeof en;

const es: BookingText = {
  switchTo: "English",
  title: "Citas en línea",
  request: "Solicitar una cita",
  notAvailable: (phone) => `Esta oficina no ofrece citas en línea. Llame a la oficina${phone ? ` al ${phone}` : ""}.`,
  noTimes: (phone) => `No hay horarios disponibles por ahora. Llame a la oficina${phone ? ` al ${phone}` : ""}.`,
  pickAnother: "Elegir otro horario",
  anyProvider: "Cualquier profesional",
  provider: "Profesional",
  when: (date, time) => `${date}, ${time}`,
  timesNote: (city) => `Los horarios están en la hora de ${city}. La oficina confirmará su solicitud.`,
  firstName: "Nombre",
  lastName: "Apellido",
  dob: "Fecha de nacimiento",
  mobile: "Teléfono celular",
  email: "Correo electrónico",
  payer: "Compañía de seguro (opcional)",
  memberId: "Número de miembro (opcional)",
  reason: "Motivo de la cita (opcional)",
  smsConsent: "Envíenme mensajes de texto sobre esta cita. Pueden aplicar tarifas de mensajes y datos; responda STOP para dejar de recibirlos.",
  sending: "Enviando...",
  requestWhen: (when) => `Solicitar: ${when}`,
  contactNote: "Dé un teléfono o un correo electrónico para que la oficina pueda confirmar. En caso de emergencia, llame al 911.",
  sentFor: (when) => `Solicitud enviada: ${when}`,
  sentNote: "La oficina la confirmará por teléfono, mensaje de texto o correo electrónico. La cita no está reservada hasta que la confirmen.",
  waitlistTitle: "¿Ningún horario le conviene?",
  waitlistIntro: "Únase a la lista de espera. Cuando se abra un horario antes, lo enviamos por mensaje de texto a quienes esperan; el primero en responder lo obtiene.",
  anyTime: "Cualquier hora",
  mornings: "Mañanas (antes del mediodía)",
  afternoons: "Tardes (desde el mediodía)",
  hours: "Cuándo puede venir",
  waitlistConsent: "Envíenme un mensaje de texto cuando se abra un horario. Pueden aplicar tarifas de mensajes y datos; responda STOP para dejar de recibirlos.",
  waitlistNeedsText: "Los horarios se ofrecen solo por mensaje de texto; deje esto sin marcar solo si prefiere que la oficina le llame.",
  joinWaitlist: "Pedir entrar en la lista de espera",
  waitlistSent: "Solicitud enviada",
  waitlistSentNote: "La oficina la confirmará. No está en la lista de espera hasta que la confirmen.",
};

export const BOOKING_TEXT: Record<Lang, BookingText> = { en, es };

/** The booking form's errors, which the server writes in English. Anything not listed is shown as is. */
const ERRORS_ES: Record<string, string> = {
  "This booking link is not valid": "Este enlace para citas no es válido",
  "Enter your first and last name": "Escriba su nombre y apellido",
  "Enter your date of birth": "Escriba su fecha de nacimiento",
  "Enter a 10-digit phone number": "Escriba un teléfono de 10 dígitos",
  "Enter a valid email": "Escriba un correo electrónico válido",
  "Give a phone number or email so the office can confirm": "Dé un teléfono o un correo electrónico para que la oficina pueda confirmar",
  "That time is no longer available. Please pick another.": "Ese horario ya no está disponible. Elija otro.",
  "You already have requests waiting. The office will contact you.": "Ya tiene solicitudes pendientes. La oficina se comunicará con usted.",
  "Could not send the request": "No se pudo enviar la solicitud",
  "Give a mobile number: openings are offered by text": "Dé un número de celular: los horarios se ofrecen por mensaje de texto",
  "Choose one of the practice's providers": "Elija uno de los profesionales de la oficina",
  "Online booking is not open": "Esta oficina no ofrece citas en línea",
};

export function bookingError(lang: Lang, message: string) {
  return lang === "es" ? ERRORS_ES[message] ?? message : message;
}
