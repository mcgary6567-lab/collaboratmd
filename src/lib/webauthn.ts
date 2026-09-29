/**
 * Passkeys (WebAuthn), verified with Node's own crypto: registration with
 * "none" attestation (the key is trusted because the signed-in user added it,
 * not because of who made the authenticator), and sign-in by checking the
 * authenticator's signature with the stored public key.
 *
 * Every response is checked for: the challenge we issued, the site's own
 * origin, the hash of the site's domain (rpId), user presence and user
 * verification (a PIN, fingerprint or face on the device), and a signature
 * counter that never goes backwards (a sign of a cloned key).
 */
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

export const b64url = {
  encode: (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url"),
  decode: (s: string) => Buffer.from(s, "base64url"),
};

/* ------------------------------ CBOR (the subset WebAuthn uses) ------------------------------ */

type Cbor = number | string | boolean | null | Buffer | Cbor[] | Map<Cbor, Cbor>;

export function decodeCbor(buf: Buffer, offset = 0): [Cbor, number] {
  const first = buf[offset];
  const major = first >> 5;
  const info = first & 0x1f;
  let pos = offset + 1;
  let len: number;
  if (info < 24) len = info;
  else if (info === 24) { len = buf[pos]; pos += 1; }
  else if (info === 25) { len = buf.readUInt16BE(pos); pos += 2; }
  else if (info === 26) { len = buf.readUInt32BE(pos); pos += 4; }
  else if (info === 27) { len = Number(buf.readBigUInt64BE(pos)); pos += 8; }
  else throw new Error("Unsupported CBOR length");
  switch (major) {
    case 0: return [len, pos];
    case 1: return [-1 - len, pos];
    case 2: return [buf.subarray(pos, pos + len), pos + len];
    case 3: return [buf.subarray(pos, pos + len).toString("utf8"), pos + len];
    case 4: {
      const arr: Cbor[] = [];
      for (let i = 0; i < len; i++) { const [v, p] = decodeCbor(buf, pos); arr.push(v); pos = p; }
      return [arr, pos];
    }
    case 5: {
      const map = new Map<Cbor, Cbor>();
      for (let i = 0; i < len; i++) { const [k, p1] = decodeCbor(buf, pos); const [v, p2] = decodeCbor(buf, p1); map.set(k, v); pos = p2; }
      return [map, pos];
    }
    case 7: return [info === 20 ? false : info === 21 ? true : null, pos];
    default: throw new Error("Unsupported CBOR type");
  }
}

/* ------------------------------ Authenticator data ------------------------------ */

const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_AT = 0x40;

export function parseAuthData(data: Buffer) {
  if (data.length < 37) throw new Error("Authenticator data too short");
  const rpIdHash = data.subarray(0, 32);
  const flags = data[32];
  const signCount = data.readUInt32BE(33);
  let credential: { id: Buffer; publicKey: Map<Cbor, Cbor> } | null = null;
  if (flags & FLAG_AT) {
    const idLen = data.readUInt16BE(53);
    const id = data.subarray(55, 55 + idLen);
    const [key] = decodeCbor(data, 55 + idLen);
    if (!(key instanceof Map)) throw new Error("No public key in the authenticator data");
    credential = { id, publicKey: key };
  }
  return { rpIdHash, flags, signCount, credential };
}

/** A COSE public key as a Node key and its algorithm (ES256 -7, RS256 -257, EdDSA -8). */
export function coseToKey(cose: Map<Cbor, Cbor>): { key: KeyObject; alg: number } {
  const kty = cose.get(1);
  const alg = Number(cose.get(3));
  const b = (label: number) => b64url.encode(cose.get(label) as Buffer);
  if (kty === 2 && cose.get(-1) === 1) return { key: createPublicKey({ key: { kty: "EC", crv: "P-256", x: b(-2), y: b(-3) }, format: "jwk" }), alg: alg || -7 };
  if (kty === 3) return { key: createPublicKey({ key: { kty: "RSA", n: b(-1), e: b(-2) }, format: "jwk" }), alg: alg || -257 };
  if (kty === 1 && cose.get(-1) === 6) return { key: createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b(-2) }, format: "jwk" }), alg: alg || -8 };
  throw new Error("Unsupported passkey type");
}

type Expected = { challenge: string; origin: string; rpId: string };

function checkClientData(clientDataJSON: Buffer, type: string, e: Expected) {
  let c: { type?: string; challenge?: string; origin?: string };
  try { c = JSON.parse(clientDataJSON.toString("utf8")); } catch { throw new Error("Unreadable client data"); }
  if (c.type !== type) throw new Error("Wrong kind of passkey response");
  if (c.challenge !== e.challenge) throw new Error("The passkey answered a different request; try again");
  if (c.origin !== e.origin) throw new Error("The passkey was used on a different site");
}

function checkAuthData(a: ReturnType<typeof parseAuthData>, e: Expected) {
  if (!a.rpIdHash.equals(createHash("sha256").update(e.rpId).digest())) throw new Error("The passkey belongs to a different site");
  if (!(a.flags & FLAG_UP)) throw new Error("The passkey did not confirm a person was present");
  if (!(a.flags & FLAG_UV)) throw new Error("The passkey did not verify the person (PIN, fingerprint or face)");
}

/** Checks a new passkey and returns what to store. */
export function verifyRegistration(r: { attestationObject: string; clientDataJSON: string }, e: Expected) {
  const clientData = b64url.decode(r.clientDataJSON);
  checkClientData(clientData, "webauthn.create", e);
  const [att] = decodeCbor(b64url.decode(r.attestationObject));
  if (!(att instanceof Map)) throw new Error("Unreadable attestation");
  const authData = parseAuthData(att.get("authData") as Buffer);
  checkAuthData(authData, e);
  if (!authData.credential) throw new Error("No passkey in the response");
  const { key, alg } = coseToKey(authData.credential.publicKey);
  return { id: b64url.encode(authData.credential.id), publicKey: b64url.encode(key.export({ type: "spki", format: "der" })), algorithm: alg, signCount: authData.signCount };
}

/** Checks a sign-in with a stored passkey and returns its new signature counter. */
export function verifyAssertion(
  r: { authenticatorData: string; clientDataJSON: string; signature: string },
  stored: { publicKey: string; algorithm: number; signCount: number },
  e: Expected,
) {
  const clientData = b64url.decode(r.clientDataJSON);
  checkClientData(clientData, "webauthn.get", e);
  const authDataBuf = b64url.decode(r.authenticatorData);
  const authData = parseAuthData(authDataBuf);
  checkAuthData(authData, e);
  const key = createPublicKey({ key: b64url.decode(stored.publicKey), format: "der", type: "spki" });
  const signed = Buffer.concat([authDataBuf, createHash("sha256").update(clientData).digest()]);
  const sig = b64url.decode(r.signature);
  const ok = stored.algorithm === -8 ? verify(null, signed, key, sig) : stored.algorithm === -7 ? verify("sha256", signed, { key, dsaEncoding: "der" }, sig) : verify("sha256", signed, key, sig);
  if (!ok) throw new Error("The passkey signature did not check out");
  if (stored.signCount > 0 && authData.signCount > 0 && authData.signCount <= stored.signCount) throw new Error("This passkey may have been copied; remove it and add it again");
  return { signCount: authData.signCount };
}
