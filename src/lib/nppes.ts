/**
 * Looks up an NPI in CMS's public NPI Registry (NPPES), so a provider or
 * practice is entered as enrolled rather than retyped. No key is needed; the
 * registry is public. Only the NPI is sent.
 */
import { isValidNpi } from "@/lib/scrub/rules";
import { normalizePhone, normalizeZip } from "@/lib/us";

export type NpiRecord = {
  npi: string;
  kind: "individual" | "organization";
  name: string;
  firstName: string | null;
  lastName: string | null;
  credential: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  taxonomy: string | null;
  specialty: string | null;
  active: boolean;
};

type Raw = {
  number?: string | number; enumeration_type?: string;
  basic?: { first_name?: string; last_name?: string; credential?: string; organization_name?: string; status?: string };
  addresses?: { address_purpose?: string; address_1?: string; city?: string; state?: string; postal_code?: string; telephone_number?: string }[];
  taxonomies?: { code?: string; desc?: string; primary?: boolean }[];
};

const title = (s?: string) => (s ?? "").toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim() || null;

export function parseNppes(json: unknown, npi: string): NpiRecord | null {
  const r = ((json as { results?: Raw[] })?.results ?? []).find((x) => String(x.number) === npi);
  if (!r) return null;
  const org = r.enumeration_type === "NPI-2";
  const loc = r.addresses?.find((a) => a.address_purpose === "LOCATION") ?? r.addresses?.[0];
  const tax = r.taxonomies?.find((t) => t.primary) ?? r.taxonomies?.[0];
  const first = title(r.basic?.first_name);
  const last = title(r.basic?.last_name);
  return {
    npi,
    kind: org ? "organization" : "individual",
    name: org ? (r.basic?.organization_name ?? "").trim() : [first, last].filter(Boolean).join(" "),
    firstName: org ? null : first,
    lastName: org ? null : last,
    credential: r.basic?.credential?.replace(/\./g, "").trim() || null,
    address1: title(loc?.address_1),
    city: title(loc?.city),
    state: loc?.state?.toUpperCase() ?? null,
    zip: normalizeZip(loc?.postal_code),
    phone: normalizePhone(loc?.telephone_number),
    taxonomy: tax?.code ?? null,
    specialty: tax?.desc ?? null,
    active: (r.basic?.status ?? "A") === "A",
  };
}

export async function lookupNpi(npi: string, fetcher: typeof fetch = fetch): Promise<NpiRecord | null> {
  const n = npi.replace(/\D/g, "");
  if (!isValidNpi(n)) throw new Error("That NPI fails its check digit");
  const res = await fetcher(`https://npiregistry.cms.hhs.gov/api/?version=2.1&number=${n}`, { signal: AbortSignal.timeout(6000), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("The NPI Registry did not answer; try again or type the details");
  return parseNppes(await res.json(), n);
}
