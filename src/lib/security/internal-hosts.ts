/**
 * Telling an address on the internet from one inside the deployment.
 *
 * Balancia makes one outbound request whose destination a *user* chooses: a
 * Web Push endpoint, handed over at subscription time and stored against the
 * account. Everything else it calls — the exchange-rate provider, an OCR
 * reader — is named by the operator in the environment.
 *
 * That one is enough to matter. Without this check an account holder could
 * subscribe with `https://10.0.0.5/` or `https://169.254.169.254/`, and the
 * notification worker would dutifully POST to it every time something happened
 * in one of their groups — a request originating inside the network, from a
 * host that can usually reach more than the internet can.
 *
 * ## Why a denylist and not an allowlist
 *
 * The airtight version of this is four hostnames: Google's, Mozilla's,
 * Microsoft's and Apple's push services, which between them issue every
 * endpoint a mainstream browser will ever produce. It was not chosen, because
 * the people most likely to self-host this app are also the people most likely
 * to be running a de-Googled phone or a Chromium fork whose push service is
 * somewhere else entirely, and a subscription that silently fails is a
 * notification bug nobody can diagnose from inside the app. Refusing the
 * addresses that are never a push service costs those setups nothing.
 *
 * ## What this does not do
 *
 * It reads the hostname, so a name that resolves *into* one of these ranges
 * still passes — classic DNS rebinding. Closing that needs the address checked
 * after resolution and pinned for the connection, which is a custom dispatcher
 * rather than a predicate. The residual is small here: the request carries an
 * encrypted payload, sends no cookies, refuses redirects, and its body never
 * reaches the subscriber, so what an attacker buys is a blind POST and a
 * timing signal. Worth knowing about; not worth an HTTP agent.
 */

/** Reserved IPv4 ranges, as [first octet match, predicate] pairs. */
function isInternalIpv4(parts: readonly number[]): boolean {
  const [a = 0, b = 0] = parts;
  return (
    a === 0 || // "this network"
    a === 10 || // RFC 1918 private
    a === 127 || // loopback
    (a === 169 && b === 254) || // link-local, and cloud metadata at .169.254
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918 private
    (a === 192 && b === 168) || // RFC 1918 private
    (a === 100 && b >= 64 && b <= 127) || // RFC 6598 carrier-grade NAT
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** Parses dotted-quad IPv4, or null if `value` is not one. */
function parseIpv4(value: string): number[] | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;

  const octets: number[] = [];
  for (const part of parts) {
    // Reject "01" and "0x7f" alongside the obvious: a leading zero is read as
    // octal by some resolvers and as decimal by others, which is a way to
    // write 127.0.0.1 that this function would otherwise not recognise.
    if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part.startsWith("0"))) {
      return null;
    }
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

/**
 * Parses an IPv6 literal into its eight 16-bit groups, or null if `value` is
 * not one.
 *
 * Read as numbers rather than matched as text, because the same address has
 * many spellings and the one that arrives here is not the one anybody typed.
 * `new URL()` rewrites an IPv6 host into its own canonical form before this
 * ever sees it: `https://[::ffff:127.0.0.1]/` reaches us as `[::ffff:7f00:1]`,
 * and a pattern written for the dotted spelling waves that straight through.
 */
function parseIpv6(value: string): number[] | null {
  // A zone ("%eth0") says which interface to use, not which address.
  const address = value.replace(/%.*$/, "");

  const halves = address.split("::");
  if (halves.length > 2) return null;
  const [head = "", tail] = halves;
  const left = head === "" ? [] : head.split(":");
  const right = tail === undefined || tail === "" ? [] : tail.split(":");

  // A trailing dotted quad stands for the last two groups.
  const last = tail === undefined ? left : right;
  const quad = last.at(-1);
  if (quad?.includes(".")) {
    const octets = parseIpv4(quad);
    if (!octets) return null;
    const [a = 0, b = 0, c = 0, d = 0] = octets;
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    last.splice(-1, 1, high, low);
  }

  const toGroups = (parts: readonly string[]): number[] | null => {
    const groups: number[] = [];
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };
  const leftGroups = toGroups(left);
  const rightGroups = toGroups(right);
  if (!leftGroups || !rightGroups) return null;

  // Without "::" all eight groups are spelled out; with it, "::" stands for
  // at least one group of zeros.
  if (tail === undefined) return leftGroups.length === 8 ? leftGroups : null;
  const missing = 8 - leftGroups.length - rightGroups.length;
  if (missing < 1) return null;
  return [...leftGroups, ...new Array<number>(missing).fill(0), ...rightGroups];
}

function isInternalIpv6(value: string): boolean {
  const groups = parseIpv6(value.toLowerCase());
  if (!groups) return true;
  const [g0 = 0, g1 = 0, g2 = 0] = groups;
  const [g5 = 0, g6 = 0, g7 = 0] = groups.slice(5);
  /** Whether groups `from` up to but not including `to` are all zero. */
  const zeros = (from: number, to: number) =>
    groups.slice(from, to).every((group) => group === 0);

  // :: unspecified and ::1 loopback.
  if (zeros(0, 7) && g7 <= 1) return true;

  /*
   * An IPv4 address wearing a hat.
   *
   * These ranges carry an IPv4 address in their last 32 bits, and reaching
   * one reaches that IPv4 address: `::ffff:0:0/96` is how a dual-stack socket
   * spells IPv4 itself, `::/96` is the deprecated IPv4-compatible form, and
   * `64:ff9b::/96` is the well-known NAT64 prefix, which a translator on the
   * path turns back into the IPv4 address inside. Each is judged by the
   * address it carries, so `::ffff:8.8.8.8` is as public as 8.8.8.8 and
   * `64:ff9b::a9fe:a9fe` as internal as the metadata service it names.
   */
  const mapped = zeros(0, 5) && g5 === 0xffff;
  const compatible = zeros(0, 6);
  const nat64 = g0 === 0x64 && g1 === 0xff9b && zeros(2, 6);
  if (mapped || compatible || nat64) {
    return isInternalIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }

  /*
   * `64:ff9b:1::/48` is NAT64 for a network's own use (RFC 8215), and there
   * the IPv4 address need not sit in the last 32 bits: where it goes depends
   * on the prefix length that network chose. A push service never lives
   * behind somebody's private translator, so the whole range is refused
   * rather than guessed at.
   */
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 1) return true;

  return (
    (g0 & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (g0 & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (g0 & 0xff00) === 0xff00 // ff00::/8 multicast
  );
}

/**
 * Whether `hostname` names something inside the deployment rather than out on
 * the internet. Takes a bare hostname — `new URL(…).hostname`, brackets and
 * all — and answers conservatively: anything it cannot make sense of is
 * treated as internal.
 */
export function isInternalHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return true;

  // URL keeps IPv6 literals in their brackets.
  if (host.startsWith("[") && host.endsWith("]")) {
    return isInternalIpv6(host.slice(1, -1));
  }
  // A bare colon means an IPv6 literal that arrived without them.
  if (host.includes(":")) return isInternalIpv6(host);

  const ipv4 = parseIpv4(host);
  if (ipv4) return isInternalIpv4(ipv4);

  /*
   * An address that wanted to be an IP and was not read as one.
   *
   * `parseIpv4` deliberately refuses the alternative encodings — `0177.0.0.1`,
   * `0x7f.0.0.1` — because it cannot know which of them the resolver will
   * expand back to 127.0.0.1, and several of them do. Falling through to the
   * hostname rules would then let those pass as ordinary domains, which is the
   * whole trick.
   *
   * A real domain never ends in a numeric label: there is no all-digit TLD and
   * the standard forbids one. So a final label of digits or a hex literal
   * means an IP was intended, and one this function could not read is one it
   * refuses.
   */
  const lastLabel = host.slice(host.lastIndexOf(".") + 1);
  if (/^(?:\d+|0x[0-9a-f]+)$/.test(lastLabel)) return true;

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // mDNS and the two suffixes RFC 6762 and RFC 8375 set aside for home
  // networks. A push service is never on one.
  if (host.endsWith(".local") || host.endsWith(".home.arpa")) return true;
  // A single label resolves through the resolver's search domain, which is to
  // say: somewhere on this network. A public push endpoint always has a dot.
  if (!host.includes(".")) return true;

  return false;
}

/**
 * Whether a push endpoint is one this server may call: absolute, HTTPS, and
 * out on the internet.
 *
 * Lives here rather than beside the subscription table because two places need
 * it and neither should have to import the other — the schema, which refuses a
 * new subscription, and the sender, which re-checks a row that may predate the
 * rule.
 */
export function isSendableEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !isInternalHost(url.hostname);
}
