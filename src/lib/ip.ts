/**
 * IP allowlists: a list of addresses or CIDR ranges, IPv4 or IPv6.
 * An empty list allows everyone.
 */

type Parsed = { v: 4 | 6; n: bigint };

function parseV4(s: string): bigint | null {
  const parts = s.split(".");
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = (n << BigInt(8)) | BigInt(Number(p));
  }
  return n;
}

function parseV6(s: string): bigint | null {
  let str = s.toLowerCase();
  // An IPv4 tail (::ffff:10.0.0.1) becomes two groups.
  const v4 = str.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = parseV4(v4[1]);
    if (n === null) return null;
    str = str.slice(0, -v4[1].length) + `${(n >> BigInt(16)).toString(16)}:${(n & BigInt(0xffff)).toString(16)}`;
  }
  const halves = str.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) | BigInt(parseInt(g, 16));
  }
  return n;
}

export function parseIp(raw: string): Parsed | null {
  const s = raw.trim().replace(/^\[|\]$/g, "");
  if (s.includes(":")) {
    const n = parseV6(s);
    if (n === null) return null;
    // IPv4-mapped IPv6 (::ffff:a.b.c.d) is the IPv4 address.
    if (n >> BigInt(32) === BigInt(0xffff)) return { v: 4, n: n & BigInt(0xffffffff) };
    return { v: 6, n };
  }
  const n = parseV4(s);
  return n === null ? null : { v: 4, n };
}

/** An address or a CIDR range, or null when it is not one. */
export function parseCidr(raw: string): { v: 4 | 6; net: bigint; bits: number } | null {
  const [addr, len, extra] = raw.trim().split("/");
  if (extra !== undefined) return null;
  const ip = parseIp(addr);
  if (!ip) return null;
  const max = ip.v === 4 ? 32 : 128;
  const bits = len === undefined ? max : /^\d{1,3}$/.test(len) ? Number(len) : NaN;
  if (!Number.isInteger(bits) || bits < 0 || bits > max) return null;
  const mask = bits === 0 ? BigInt(0) : ((BigInt(1) << BigInt(bits)) - BigInt(1)) << BigInt(max - bits);
  return { v: ip.v, net: ip.n & mask, bits };
}

export function inCidr(ip: string, cidr: string): boolean {
  const a = parseIp(ip);
  const c = parseCidr(cidr);
  if (!a || !c || a.v !== c.v) return false;
  const max = c.v === 4 ? 32 : 128;
  const mask = c.bits === 0 ? BigInt(0) : ((BigInt(1) << BigInt(c.bits)) - BigInt(1)) << BigInt(max - c.bits);
  return (a.n & mask) === c.net;
}

export function ipAllowed(ip: string | null, allowlist: string[]): boolean {
  if (!allowlist.length) return true;
  if (!ip) return false;
  return allowlist.some((c) => inCidr(ip, c));
}

/** The caller's address as the platform reports it (Vercel sets x-forwarded-for; the first entry is the client). */
export function clientIp(h: { get(name: string): string | null }): string | null {
  const fwd = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || h.get("x-real-ip")?.trim() || null;
}
