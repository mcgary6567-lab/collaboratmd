import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signSamlPost } from "@node-saml/node-saml/lib/saml-post-signing";
import { testDb } from "@/test/db";
import { buildEdi837I } from "@/lib/edi/x837i";
import { completeSaml, normalizeCert, samlLoginUrl, samlUrls, spMetadata } from "./saml";
import { getSso, saveSso, ssoUser } from "./sso";

// A test-only key pair generated for these tests; it is not any real identity provider's.
const FIX = path.join(process.cwd(), "src/test/fixtures");
const KEY = fs.readFileSync(path.join(FIX, "saml-idp-key.pem"), "utf8");
const CERT = fs.readFileSync(path.join(FIX, "saml-idp-cert.pem"), "utf8");
const ORIGIN = "https://app.test";
const IDP = "https://idp.test/entity";

function requestId(url: string) {
  const xml = zlib.inflateRawSync(Buffer.from(new URL(url).searchParams.get("SAMLRequest")!, "base64")).toString();
  return xml.match(/ID="([^"]+)"/)![1];
}

function response(opts: { inResponseTo: string; email: string; acs: string; audience: string }) {
  const now = new Date();
  const iso = (ms: number) => new Date(now.getTime() + ms).toISOString();
  const xml = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${Date.now()}" Version="2.0" IssueInstant="${iso(0)}" Destination="${opts.acs}" InResponseTo="${opts.inResponseTo}">`
    + `<saml:Issuer>${IDP}</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>`
    + `<saml:Assertion ID="_a${Date.now()}" Version="2.0" IssueInstant="${iso(0)}"><saml:Issuer>${IDP}</saml:Issuer>`
    + `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${opts.email}</saml:NameID>`
    + `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData InResponseTo="${opts.inResponseTo}" NotOnOrAfter="${iso(300_000)}" Recipient="${opts.acs}"/></saml:SubjectConfirmation></saml:Subject>`
    + `<saml:Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(300_000)}"><saml:AudienceRestriction><saml:Audience>${opts.audience}</saml:Audience></saml:AudienceRestriction></saml:Conditions>`
    + `<saml:AuthnStatement AuthnInstant="${iso(0)}" SessionIndex="_s1"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`
    + `</saml:Assertion></samlp:Response>`;
  return signSamlPost(xml, "//*[local-name(.)='Assertion']", { privateKey: KEY, signatureAlgorithm: "sha256" });
}

describe("SAML single sign-on", () => {
  let t: Awaited<ReturnType<typeof testDb>>;
  beforeAll(async () => { t = await testDb(); });
  afterAll(async () => { await t?.close(); });

  it("accepts a signed assertion once, in reply to our request, and refuses tampering and replays", async () => {
    expect(() => normalizeCert("not a certificate")).toThrow(/X.509/);
    await saveSso(t.db, t.practiceId, { protocol: "saml", samlEntryPoint: "https://idp.test/sso", samlIdpIssuer: IDP, samlIdpCert: CERT, domains: "samlpractice.org", enforce: false, autoProvision: true, defaultRole: "front_desk" }, t.userId);
    const cfg = (await getSso(t.db, t.practiceId))!;
    expect(cfg).toMatchObject({ protocol: "saml", issuer: null, clientSecretSealed: null });
    const urls = samlUrls(ORIGIN, t.practiceId);
    expect(spMetadata(t.db, cfg, ORIGIN)).toContain(urls.acs);

    const login = await samlLoginUrl(t.db, cfg, ORIGIN, "pat@samlpractice.org");
    expect(login.startsWith("https://idp.test/sso?")).toBe(true);
    const id = requestId(login);
    const signed = response({ inResponseTo: id, email: "Pat@SamlPractice.org", acs: urls.acs, audience: urls.entityId });

    // Changing the email after signing breaks the signature (checked on its own request: a failed attempt uses its request up).
    const idT = requestId(await samlLoginUrl(t.db, cfg, ORIGIN, "pat@samlpractice.org"));
    const tampered = response({ inResponseTo: idT, email: "Pat@SamlPractice.org", acs: urls.acs, audience: urls.entityId }).replace("Pat@SamlPractice.org", "admin@samlpractice.org");
    await expect(completeSaml(t.db, cfg, ORIGIN, Buffer.from(tampered).toString("base64"))).rejects.toThrow();
    const claims = await completeSaml(t.db, cfg, ORIGIN, Buffer.from(signed).toString("base64"));
    expect(claims).toMatchObject({ email: "pat@samlpractice.org" });
    const user = await ssoUser(t.db, cfg, claims);
    expect(user).toMatchObject({ email: "pat@samlpractice.org", role: "front_desk" });
    // The same response again: its request was used up.
    await expect(completeSaml(t.db, cfg, ORIGIN, Buffer.from(signed).toString("base64"))).rejects.toThrow();

    // A response to a request we never sent.
    const stray = response({ inResponseTo: "_never_sent", email: "pat@samlpractice.org", acs: urls.acs, audience: urls.entityId });
    await expect(completeSaml(t.db, cfg, ORIGIN, Buffer.from(stray).toString("base64"))).rejects.toThrow();
    // Another domain.
    const id2 = requestId(await samlLoginUrl(t.db, cfg, ORIGIN, "x@evil.org"));
    const foreign = response({ inResponseTo: id2, email: "x@evil.org", acs: urls.acs, audience: urls.entityId });
    await expect(completeSaml(t.db, cfg, ORIGIN, Buffer.from(foreign).toString("base64"))).rejects.toThrow(/not in a domain/);
  });
});

describe("secondary facility claims", () => {
  it("send the primary payer's adjudication in 2320/2330 and mark the claim secondary", () => {
    const edi = buildEdi837I({
      controlNumber: "CMD9", interchangeControl: "1", senderId: "S", receiverId: "R", now: new Date("2026-09-25T12:00:00Z"),
      billingProvider: { name: "General Hospital", npi: "1234567893", taxId: "12-3456789", address1: "1 Main", city: "Dallas", state: "TX", zip: "75201" },
      attending: { lastName: "Doc", firstName: "A", npi: "1234567893", taxonomy: "207Q00000X" },
      payer: { name: "Medigap Co", payerId: "MG1", type: "commercial" },
      subscriber: { lastName: "Doe", firstName: "Jane", memberId: "S1", dob: "1950-01-01", sex: "F", relationship: "self" },
      claim: { totalCents: 100_000, frequencyCode: "1", diagnoses: ["R07.9"], institutional: { typeOfBill: "0131", statementFrom: "2026-09-01", statementTo: "2026-09-01", patientStatus: "01" } },
      lines: [{ revenueCode: "0450", hcpcs: "99284", chargeCents: 100_000, units: 1, dateOfService: "2026-09-01" }],
      otherPayer: { name: "Medicare Part A", payerId: "MCA", subscriber: { lastName: "Doe", firstName: "Jane", memberId: "1EG4TE5MK72", relationship: "self" }, paidCents: 60_000, adjudicatedOn: "2026-09-15", adjustments: [{ group: "CO", reason: "45", amountCents: 20_000 }, { group: "PR", reason: "2", amountCents: 20_000 }] },
    });
    expect(edi).toContain("SBR*S*18");
    expect(edi).toContain("CAS*CO*45*200.00~\nCAS*PR*2*200.00~\nAMT*D*600.00");
    expect(edi).toContain("NM1*PR*2*Medicare Part A*****PI*MCA~\nDTP*573*D8*20260915");
    expect(edi.indexOf("DTP*573")).toBeLessThan(edi.indexOf("LX*1"));
  });
});
