import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isInternalHost } from "@/lib/security/internal-hosts";
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
 *    is named here so it is not mistaken for solved;
 *  - the operator can **allow the local network** (`BACKUP_ALLOW_PRIVATE_ENDPOINTS`),
 *    because backing up to a NAS is the commonest reason to self-host in the
 *    first place. Even then the link-local range stays refused: nothing a
 *    person wants to back up to lives at 169.254.169.254.
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

/** The metadata services every cloud answers on, whatever else is allowed. */
function isMetadataAddress(address: string): boolean {
  const value = address.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    value.startsWith("169.254.") ||
    value === "fd00:ec2::254" ||
    value.startsWith("fe80:")
  );
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
