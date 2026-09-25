/**
 * Stedi clearinghouse adapter (https://www.stedi.com/docs/healthcare).
 *
 * Selected with CLEARINGHOUSE=stedi and STEDI_API_KEY. Uses Stedi's raw X12
 * endpoints, so the 837P and 270 this app builds are sent as they are:
 *
 *   837P  POST /change/medicalnetwork/professionalclaims/v3/raw-x12-submission
 *         -> { status, controlNumber, claimReference.correlationId, x12 }
 *            where x12 is Stedi's own acknowledgment; the payer's 277CA and
 *            the 835 arrive later.
 *   270   POST /change/medicalnetwork/eligibility/v3/raw-x12
 *         -> the 271 rendered as JSON (benefitsInformation, errors).
 *   276   POST /change/medicalnetwork/claimstatus/v2/raw-x12
 *         -> JSON that includes the raw 277 in its x12 field.
 *
 * Stedi replaces the ISA/GS envelope with its own and routes on the payer ID
 * in loop 2010BB (claims) or 2100A (eligibility).
 *
 * Not built against a live account: request and response shapes follow
 * Stedi's published API reference, and the adapter is covered by tests with a
 * stubbed HTTP layer. Retrieving payer 277CAs and 835 ERAs (Stedi delivers
 * them through transaction polling or webhooks) is not implemented, so with
 * this adapter remittances must be imported as 835 files.
 */
import type { Benefit, Response271 } from "@/lib/edi/x270";
import { parse277CA } from "@/lib/edi/x277ca";
import type { ClearinghouseGateway, EligibilityAnswer, RemitRequest, SubmissionMeta, SubmissionResult } from "./gateway";

const BASE = "https://healthcare.us.stedi.com/2024-04-01";

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

interface StediClaimResponse {
  status?: string;
  controlNumber?: string;
  claimReference?: { correlationId?: string; patientControlNumber?: string; payerId?: string };
  x12?: string;
}

interface StediBenefit {
  code?: string;
  coverageLevelCode?: string;
  serviceTypeCodes?: string[];
  insuranceTypeCode?: string;
  planCoverage?: string;
  timeQualifierCode?: string;
  benefitAmount?: string;
  benefitPercent?: string;
  inPlanNetworkIndicatorCode?: string;
}

interface StediEligibilityResponse {
  benefitsInformation?: StediBenefit[];
  errors?: { code?: string; description?: string; followupAction?: string }[];
  payer?: { name?: string };
  subscriber?: { memberId?: string };
  planDateInformation?: { planBegin?: string };
  meta?: { traceId?: string };
}

export class StediClearinghouse implements ClearinghouseGateway {
  constructor(
    private readonly apiKey: string,
    private readonly http: Fetch = fetch as unknown as Fetch,
  ) {}

  private async post<T>(path: string, body: unknown, idempotencyKey?: string): Promise<T> {
    const res = await this.http(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`Stedi returned ${res.status}${detail ? `: ${detail}` : ""}`);
    }
    return (await res.json()) as T;
  }

  async submit837(edi: string, meta: SubmissionMeta): Promise<SubmissionResult> {
    // The idempotency key makes a retried request safe: Stedi will not send the claim twice.
    const path = meta.claimType === "institutional"
      ? "/change/medicalnetwork/institutionalclaims/v1/raw-x12-submission"
      : "/change/medicalnetwork/professionalclaims/v3/raw-x12-submission";
    const r = await this.post<StediClaimResponse>(path, { x12: edi }, `claim-${meta.controlNumber}`);
    const clearinghouseId = r.claimReference?.correlationId ?? r.controlNumber ?? "";
    const ack = r.x12 ? parse277CA(r.x12).find((c) => c.controlNumber === meta.controlNumber) ?? parse277CA(r.x12)[0] : undefined;
    if (ack && !ack.accepted) {
      return {
        clearinghouseId, accepted: false, status: "rejected", ack277: r.x12,
        rejectionCode: [ack.category, ack.statusCode, ack.entity].filter(Boolean).join(":"), message: ack.message,
      };
    }
    if (r.status && r.status !== "SUCCESS") {
      return { clearinghouseId, accepted: false, status: "rejected", message: `Stedi status ${r.status}` };
    }
    // Accepted by the clearinghouse; the payer's own acceptance comes later.
    return { clearinghouseId, accepted: true, status: "accepted", ack277: r.x12, message: "Accepted by Stedi and forwarded to the payer" };
  }

  async checkEligibility(edi270: string): Promise<EligibilityAnswer> {
    const r = await this.post<StediEligibilityResponse>("/change/medicalnetwork/eligibility/v3/raw-x12", { x12: edi270 });
    return { format: "json", raw: JSON.stringify(r), response: toResponse271(r) };
  }

  /** 276 out, and the raw 277 from the x12 field of Stedi's response. */
  /**
   * Not wired to Stedi in this version: its prior authorization product has
   * not been verified against this integration, so rather than guess at a
   * live payer API the request is refused with a clear next step.
   */
  async requestAuthorization(_edi278: string): Promise<string> {
    throw new Error("Electronic prior authorization (278) is not enabled for Stedi in this version. Request it on the payer's portal, then record the authorization number here.");
  }

  async checkClaimStatus(edi276: string): Promise<string> {
    const r = await this.post<{ x12?: string }>("/change/medicalnetwork/claimstatus/v2/raw-x12", { x12: edi276 });
    if (!r.x12) throw new Error("Stedi returned no 277 for the status request");
    return r.x12;
  }

  /** ERAs from Stedi arrive by polling or webhook, which this adapter does not implement. */
  async fetch835(_claims: RemitRequest[]): Promise<string | null> {
    return null;
  }
}

/** Stedi's JSON 271 as the same structure a raw 271 parses to. */
export function toResponse271(r: StediEligibilityResponse): Response271 {
  const cents = (v?: string) => (v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100));
  const benefits: Benefit[] = (r.benefitsInformation ?? []).map((b) => ({
    code: b.code ?? "",
    coverageLevel: b.coverageLevelCode ?? "",
    serviceType: b.serviceTypeCodes?.[0] ?? "",
    insuranceType: b.insuranceTypeCode ?? "",
    planDescription: b.planCoverage ?? "",
    timePeriod: b.timeQualifierCode ?? "",
    amountCents: cents(b.benefitAmount),
    percent: b.benefitPercent !== undefined && Number.isFinite(Number(b.benefitPercent)) ? Math.round(Number(b.benefitPercent) * 10000) / 100 : null,
    inNetwork: b.inPlanNetworkIndicatorCode ?? "",
  }));
  const planBegin = r.planDateInformation?.planBegin ?? "";
  return {
    traceNumber: "",
    payerName: r.payer?.name ?? "",
    memberId: r.subscriber?.memberId ?? "",
    rejections: (r.errors ?? []).map((e) => ({ code: e.code ?? "", reason: e.description ?? `Rejection ${e.code}`, followUp: e.followupAction ?? "" })),
    planBegin: /^\d{8}$/.test(planBegin) ? `${planBegin.slice(0, 4)}-${planBegin.slice(4, 6)}-${planBegin.slice(6)}` : planBegin,
    benefits,
  };
}
