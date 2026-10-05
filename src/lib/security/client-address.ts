/**
 * How much of a client's address a rate limit counts.
 *
 * An IPv4 address is roughly one subscriber — a household behind a NAT, which
 * is what every per-address ceiling in `rate-limit.ts` is already sized for. An
 * IPv6 address is not. A subscriber is handed a /64 at the very least, more
 * often a /56 or a /48, and every one of the 2⁶⁴ addresses in it is theirs to
 * send from; privacy extensions rotate through them without being asked.
 * Counted per address, an IPv6 client takes a fresh allowance whenever it
 * likes, and walks through sign-in, password reset and join redemption as
 * freely as a forged `X-Forwarded-For` once let anybody do.
 *
 * So an IPv6 address is counted by its /64, the smallest block anybody is
 * given, and a household on IPv6 spends one allowance as it would on IPv4. An
 * IPv4 address written as IPv6 — `::ffff:192.0.2.1`, which is how a dual-stack
 * socket reports an IPv4 peer — is counted as the IPv4 address it is, so one
 * client cannot hold two allowances by alternating how it connects.
 *
 * For rate limiting only. `clientIpFrom` still returns the address as it
 * arrived, because a session row and a log line are there to say where
 * somebody actually was, not which block they were in.
 *
 * Anything that is not an address comes back exactly as it was given: the
 * `unknown` a request with no forwarding headers gets, a header somebody
 * mangled, and every key a bucket uses that was never an address — an email,
 * an account id, a hash.
 */
export function rateLimitAddress(value: string): string {
  const groups = parseIpv6(unbracket(value.trim()));
  if (!groups) return value;

  if (isIpv4Mapped(groups)) {
    const [high, low] = [groups[6] ?? 0, groups[7] ?? 0];
    return [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");
  }

  const prefix = groups.slice(0, 4).map((group) => group.toString(16));
  return `${prefix.join(":")}::/64`;
}

/**
 * `[2001:db8::1]`, with or without a `:port` after it — the form an address
 * takes when it has to sit beside a port, and the one some proxies forward.
 */
function unbracket(value: string): string {
  const match = /^\[([^\]]*)\](?::\d{1,5})?$/.exec(value);
  return match?.[1] ?? value;
}

const HEX_GROUP = /^[0-9a-f]{1,4}$/i;
const OCTET = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** The four octets of a dotted IPv4 address, or null. */
function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4 || !parts.every((part) => OCTET.test(part))) {
    return null;
  }
  return parts.map(Number);
}

/**
 * The eight 16-bit groups of an IPv6 address, or null for anything that is
 * not one. Strict on purpose: a key that merely looks address-ish must not be
 * folded into somebody else's block.
 */
function parseIpv6(value: string): number[] | null {
  // A zone id says which interface a link-local address was reached on. It is
  // not part of the address, and two of them on one address are one client.
  let text = value.split("%", 1)[0] ?? "";
  if (!text.includes(":")) return null;

  // The last 32 bits may be written as dotted IPv4, as in `::ffff:192.0.2.1`.
  // Rewritten as two hex groups, it parses like any other address.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = parseIpv4(tail);
    if (!octets) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  // `::` stands for one or more zero groups, and may appear once.
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const compressed = halves.length === 2;
  const head = halves[0] ? halves[0].split(":") : [];
  const rest = compressed && halves[1] ? halves[1].split(":") : [];
  if (![...head, ...rest].every((group) => HEX_GROUP.test(group))) {
    return null;
  }

  const missing = 8 - head.length - rest.length;
  if (compressed ? missing < 1 : missing !== 0) return null;

  return [...head, ...Array<string>(missing).fill("0"), ...rest].map((group) =>
    Number.parseInt(group, 16),
  );
}

/** `::ffff:0:0/96` — an IPv4 address carried in IPv6 clothing. */
function isIpv4Mapped(groups: readonly number[]): boolean {
  return (
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff
  );
}
