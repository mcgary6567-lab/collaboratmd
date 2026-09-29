/**
 * US carrier registration for business texts. Texts from an ordinary (10-digit)
 * number are blocked or filtered unless the sender has registered a brand and
 * an A2P 10DLC campaign; a toll-free number needs toll-free verification
 * instead. Registration happens in the practice's Twilio account; this checks
 * where it stands and prepares the answers Twilio asks for.
 */
type Http = (url: string, init: { method?: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Twilio = { accountSid: string; authToken: string; from: string };

export type NumberKind = "local" | "toll_free" | "short_code" | "service";
export type RegistrationStatus = "approved" | "pending" | "rejected" | "not_registered" | "unknown";

/** What kind of sender the practice texts from. */
export function numberKind(from: string): NumberKind {
  const f = from.trim();
  if (/^MG[0-9a-f]{32}$/i.test(f)) return "service";
  const d = f.replace(/\D/g, "");
  if (d.length >= 5 && d.length <= 6) return "short_code";
  const national = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return /^8(00|33|44|55|66|77|88)/.test(national) ? "toll_free" : "local";
}

const A2P: Record<string, RegistrationStatus> = { VERIFIED: "approved", PENDING: "pending", IN_PROGRESS: "pending", FAILED: "rejected" };
const TOLL_FREE: Record<string, RegistrationStatus> = { TWILIO_APPROVED: "approved", PENDING_REVIEW: "pending", IN_REVIEW: "pending", TWILIO_REJECTED: "rejected" };

/** Asks Twilio whether the practice's sender is registered, and says what to do if it is not. */
export async function smsRegistrationStatus(t: Twilio, http: Http): Promise<{ kind: NumberKind; status: RegistrationStatus; detail: string }> {
  const auth = { Authorization: `Basic ${Buffer.from(`${t.accountSid}:${t.authToken}`).toString("base64")}` };
  const get = async <T,>(url: string) => {
    const r = await http(url, { headers: auth });
    if (!r.ok) throw new Error(`Twilio answered ${r.status}`);
    return (await r.json()) as T;
  };
  const kind = numberKind(t.from);
  if (kind === "short_code") return { kind, status: "approved", detail: "Short codes are approved by the carriers before Twilio issues them" };

  const campaignOf = async (service: string) => {
    const r = await get<{ compliance?: { campaign_status?: string }[] }>(`https://messaging.twilio.com/v1/Services/${service}/Compliance/Usa2p`);
    const s = r.compliance?.[0]?.campaign_status;
    return s ? { status: A2P[s] ?? "unknown" as RegistrationStatus, raw: s } : null;
  };
  if (kind === "service") {
    const c = await campaignOf(t.from);
    return c ? { kind, status: c.status, detail: `A2P 10DLC campaign ${c.raw.toLowerCase().replace(/_/g, " ")}` } : { kind, status: "not_registered", detail: "The messaging service has no A2P 10DLC campaign" };
  }

  const e164 = `+1${t.from.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "")}`;
  const numbers = await get<{ incoming_phone_numbers?: { sid: string }[] }>(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(t.accountSid)}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(e164)}`);
  const pn = numbers.incoming_phone_numbers?.[0]?.sid;
  if (!pn) return { kind, status: "unknown", detail: `${e164} is not a number in this Twilio account` };

  if (kind === "toll_free") {
    const v = await get<{ verifications?: { status?: string }[] }>(`https://messaging.twilio.com/v1/Tollfree/Verifications?TollfreePhoneNumberSid=${pn}`);
    const s = v.verifications?.[0]?.status;
    return s ? { kind, status: TOLL_FREE[s] ?? "unknown", detail: `Toll-free verification ${s.toLowerCase().replace(/_/g, " ")}` } : { kind, status: "not_registered", detail: "The toll-free number has not been submitted for verification" };
  }

  // An ordinary number is registered through the messaging service it belongs to.
  const services = await get<{ services?: { sid: string }[] }>("https://messaging.twilio.com/v1/Services?PageSize=50");
  for (const s of services.services ?? []) {
    const nums = await get<{ phone_numbers?: { phone_number?: string; sid?: string }[] }>(`https://messaging.twilio.com/v1/Services/${s.sid}/PhoneNumbers?PageSize=100`);
    if (!(nums.phone_numbers ?? []).some((n) => n.phone_number === e164 || n.sid === pn)) continue;
    const c = await campaignOf(s.sid);
    return c ? { kind, status: c.status, detail: `A2P 10DLC campaign ${c.raw.toLowerCase().replace(/_/g, " ")}` } : { kind, status: "not_registered", detail: "The number's messaging service has no A2P 10DLC campaign" };
  }
  return { kind, status: "not_registered", detail: `${e164} is not in a messaging service, so it has no A2P 10DLC registration` };
}

/** The answers Twilio's registration asks for, from the practice's own details and the texts this product sends. */
export function registrationAnswers(p: { name: string; taxId: string; address1: string; city: string; state: string; zip: string; phone: string | null }, site: string) {
  return {
    brand: [
      ["Legal business name", p.name], ["Business type", "Healthcare provider (private company or sole proprietor, as registered)"], ["EIN", p.taxId],
      ["Address", `${p.address1}, ${p.city}, ${p.state} ${p.zip}`], ["Website", site], ["Vertical", "Healthcare and life sciences"], ["Support phone", p.phone ?? ""],
    ] as [string, string][],
    campaign: [
      ["Use case", "Mixed (appointment reminders, account notifications, customer care)"],
      ["Description", `${p.name} texts its own patients who agreed to texts: appointment reminders they can confirm or cancel, offers of earlier appointment times, check-in links before a visit, and links to view and pay a bill. No marketing and no health details in the texts.`],
      ["How patients opt in", "Patients tick a box on the practice's online booking or waitlist form reading \"Text me about this appointment. Message and data rates may apply; reply STOP to stop.\", or tell the front desk, who record the patient's agreement on their record. The date of the agreement is kept."],
      ["Opt-out and help", "STOP, UNSUBSCRIBE or CANCEL ends all texts; HELP replies with the practice's name and phone number."],
      ["Sample message 1", `${p.name}: reminder of your appointment tomorrow at 9:30 AM. Check in online: ${site}/check-in/... . Reply C to confirm or X to cancel. Reply STOP to opt out.`],
      ["Sample message 2", `${p.name}: an earlier time opened with your provider on Tue at 2:00 PM. Reply B to book it. Reply STOP to opt out.`],
      ["Sample message 3", `${p.name}: your statement is ready. View and pay securely: ${site}/portal/... Reply STOP to opt out.`],
      ["Embedded links", "Yes, to the practice's own check-in and payment pages"], ["Embedded phone numbers", "Yes, the practice's number"], ["Age-gated content", "No"],
    ] as [string, string][],
  };
}
