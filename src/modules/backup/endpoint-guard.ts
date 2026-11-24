import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import {
  isInternalHost,
  parseIpv4,
  parseIpv6,
} from "@/lib/security/internal-hosts";
import { BackupError } from "./errors";

/**
 * Where a backup may be pointed.
 *
 * A WebDAV address or an S3 endpoint is the one outbound destination here that
 * a *person* chooses, and the worker will connect to it every night with their
 * credentials. Left alone that is a way to make this server speak to anything
 * it can reach: the database, the metadata service of the cloud it runs in,
 * the admin panel of a router.
 *
 * The rule is the one the push endpoints already live by
 * (`internal-hosts.ts`), with two additions that matter more here:
 *
 *  - the **name is resolved** and every address it answers with is judged, so
 *    `internal.example.com` pointing at `10.0.0.5` does not pass for being a
 *    domain. What remains is a name that changes its answer between this check
 *    and rclone's own lookup a moment later (DNS rebinding); closing that needs
 *    the connection pinned to the address checked, which rclone cannot do. It
 *    is named here so it is not mistaken for solved. So is its cousin: rclone
 *    follows a redirect to any address and has no option not to, so a public
 *    server can send the worker on to one this check would refuse. The
 *    credentials stay behind (rclone drops them when a redirect leaves the
 *    host, and `auth_redirect` is never set); the request does not. See
 *    `docs/cloud-backup.md` § Local-network destinations;
 *  - the operator can **allow the local network** (`BACKUP_ALLOW_PRIVATE_ENDPOINTS`),
 *    because backing up to a NAS is the commonest reason to self-host in the
 *    first place. Even then the platform's metadata addresses stay refused:
 *    nothing a person wants to back up to lives at 169.254.169.254.
 */

export interface GuardOptions {
  readonly allowPrivate: boolean;
  /** Resolves a name to its addresses. Replaceable so tests need no network. */
  readonly resolve?: (hostname: string) => Promise<readonly string[]>;
}

async function resolveAll(hostname: string): Promise<readonly string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * IPv4 addresses a cloud's metadata service answers on: the link-local range,
 * where AWS, Google, Azure, DigitalOcean and most others put it at
 * 169.254.169.254, and Alibaba's 100.100.100.200.
 */
function isMetadataIpv4(octets: readonly number[]): boolean {
  const [a, b, c, d] = octets;
  return (
    (a === 169 && b === 254) ||
    (a === 100 && b === 100 && c === 100 && d === 200)
  );
}

/** AWS's IPv6 metadata address, `fd00:ec2::254`, as groups. */
const AWS_IPV6_METADATA = [0xfd00, 0xec2, 0, 0, 0, 0, 0, 0x254];

/**
 * The metadata services every cloud answers on, whatever else is allowed.
 *
 * Read as numbers, never matched as text. One address has many spellings, and
 * the one that arrives here is not the one anybody typed: `new URL()` rewrites
 * `http://[::ffff:169.254.169.254]/` to `[::ffff:a9fe:a9fe]`, and a check for
 * the prefix "169.254." let that through to the metadata service. So an IPv6
 * address that carries an IPv4 one in its last 32 bits — mapped
 * (`::ffff:0:0/96`), compatible (`::/96`) or NAT64 (`64:ff9b::/96`), each of
 * which reaches that IPv4 address — is judged by the address it carries.
 *
 * Takes a host or an address, bracketed or not. A name that is neither is not
 * judged here; the addresses it resolves to are.
 */
export function isMetadataAddress(hostOrAddress: string): boolean {
  const value = hostOrAddress
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  const ipv4 = parseIpv4(value);
  if (ipv4) return isMetadataIpv4(ipv4);
  if (!value.includes(":")) return false;

  const groups = parseIpv6(value);
  // An IPv6 literal that cannot be read is not one to connect to.
  if (!groups) return true;
  const [g0 = 0, g1 = 0] = groups;
  const [g5 = 0, g6 = 0, g7 = 0] = groups.slice(5);
  const zeros = (from: number, to: number) =>
    groups.slice(from, to).every((group) => group === 0);

  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if (groups.every((group, index) => group === AWS_IPV6_METADATA[index])) {
    return true;
  }

  const mapped = zeros(0, 5) && g5 === 0xffff;
  const compatible = zeros(0, 6);
  const nat64 = g0 === 0x64 && g1 === 0xff9b && zeros(2, 6);
  if (mapped || compatible || nat64) {
    return isMetadataIpv4([g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff]);
  }
  return false;
}

export async function assertEndpointAllowed(
  endpoint: string,
  options: GuardOptions,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new BackupError("endpoint_blocked", "That is not a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new BackupError(
      "endpoint_blocked",
      "Use an http:// or https:// address.",
    );
  }

  const host = url.hostname;
  const resolve = options.resolve ?? resolveAll;

  let addresses: readonly string[];
  if (isIP(host.replace(/^\[|\]$/g, "")) !== 0) {
    // Already an address; there is nothing to look up and nothing to rebind.
    addresses = [host];
  } else {
    try {
      addresses = await resolve(host);
    } catch {
      throw new BackupError("unreachable", "That address does not resolve.");
    }
    if (addresses.length === 0) {
      throw new BackupError("unreachable", "That address does not resolve.");
    }
  }

  const everything = [host, ...addresses];
  if (everything.some(isMetadataAddress)) {
    throw new BackupError(
      "endpoint_blocked",
      "That address is reserved for the server's own platform.",
    );
  }

  const internal = everything.some((candidate) => isInternalHost(candidate));
  if (internal && !options.allowPrivate) {
    throw new BackupError(
      "endpoint_blocked",
      "That address is on a private network. Ask the administrator of this " +
        "server to allow local addresses for backups.",
    );
  }

  // Credentials over plain HTTP are only forgivable inside the house.
  if (url.protocol === "http:" && !internal) {
    throw new BackupError(
      "endpoint_blocked",
      "Use https:// — credentials would otherwise cross the internet unencrypted.",
    );
  }
}
