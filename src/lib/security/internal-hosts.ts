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

function isInternalIpv6(value: string): boolean {
  const address = value.toLowerCase();

  // An IPv4-mapped or -compatible address is an IPv4 address wearing a hat.
  const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1]) {
    const parts = parseIpv4(mapped[1]);
    return parts ? isInternalIpv4(parts) : true;
  }

  if (address === "::" || address === "::1") return true;
  // fc00::/7 unique-local, fe80::/10 link-local.
  return /^f[cd]/.test(address) || /^fe[89ab]/.test(address);
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
