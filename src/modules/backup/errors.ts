/**
 * Why a backup failed, in words the code can act on.
 *
 * rclone reports failures as prose on stderr, in the provider's own phrasing,
 * and that prose has three audiences with three different needs:
 *
 *  - the **scheduler** must know whether trying again will ever help. A revoked
 *    token will not mend itself, and retrying hourly is how an account gets
 *    flagged; a network blip will;
 *  - the **screen** needs one of a few sentences it can translate, not a
 *    provider's English;
 *  - the **person** debugging a bucket policy does want the provider's own
 *    words — scrubbed of anything secret, and short.
 *
 * So a failure is a code, for the first two, and a scrubbed `detail`, for the
 * third.
 */

export const BACKUP_ERROR_CODES = [
  /** The provider no longer accepts the credentials: revoked, expired or changed. */
  "reconnect",
  /**
   * The provider does not recognise the app (the client ID and secret) the
   * connection was made through: a secret that was reset, an app deleted, a
   * mistyped value. Reconnecting through the same app would fail the same way,
   * so this is not `reconnect`.
   */
  "app",
  /** Signed in, but not allowed to do this — a read-only key, a bucket policy. */
  "forbidden",
  /** The account or bucket is full. */
  "quota",
  /** The bucket, folder or server path does not exist. */
  "not_found",
  /** Could not reach the server: DNS, refused, timed out, bad certificate. */
  "unreachable",
  /** The provider asked us to slow down. Retried, not counted against the person. */
  "rate_limited",
  /** This server refuses to connect to a local-network address. */
  "endpoint_blocked",
  /** rclone is not installed on this server. */
  "unavailable",
  /** The recovery key is missing, so nothing can be encrypted. */
  "no_key",
  /** Nothing in the output said what went wrong. */
  "unknown",
] as const;

export type BackupErrorCode = (typeof BACKUP_ERROR_CODES)[number];

export class BackupError extends Error {
  readonly code: BackupErrorCode;
  /** Scrubbed and shortened; safe to store and to show to the owner. */
  readonly detail: string;

  constructor(code: BackupErrorCode, detail = "") {
    super(detail || code);
    this.name = "BackupError";
    this.code = code;
    this.detail = detail;
  }
}

/** Codes where trying again later cannot help until the person does something. */
export function needsPerson(code: BackupErrorCode): boolean {
  return code === "reconnect" || code === "app" || code === "no_key";
}

/**
 * Patterns, in the order they are tried. Earlier entries win, so the specific
 * ones (a full account) come before the general ones (a 403).
 */
const PATTERNS: readonly (readonly [BackupErrorCode, RegExp])[] = [
  [
    "quota",
    /storagequotaexceeded|quota ?exceeded|insufficient ?(?:storage|space)|not enough (?:space|storage)|disk (?:is )?full|\b507\b|over quota|out of space|userrateLimitExceeded.*storage/i,
  ],
  [
    "rate_limited",
    /\b429\b|too many requests|slowdown|rate ?limit(?:ed)?|throttl|request(?:s)? per second/i,
  ],
  [
    // Before `reconnect`, which would otherwise take `invalid_client` and send
    // the person round the same trip with the same wrong secret. The AADSTS
    // numbers are Microsoft's: an unknown, expired or mistyped client secret,
    // and an application that does not exist.
    "app",
    /invalid_client|aadsts7000215|aadsts7000222|aadsts700016|unauthorized_client|client (?:secret|id) is (?:invalid|incorrect)/i,
  ],
  [
    "reconnect",
    /invalid_grant|invalid[_ ]token|(?:expired|invalid)_access_token|\brevoked\b|token (?:has )?(?:expired|been (?:expired|revoked))|refresh token|couldn'?t fetch token|failed to refresh|unauthori[sz]ed|\b401\b|authenticationfailed|invalidaccesskeyid|signaturedoesnotmatch|bad credentials|invalid credentials|login (?:failed|incorrect)|incorrect (?:username|password)|wrong password|two-?factor|2fa|trust ?token|verification code|session (?:expired|has expired)|access token/i,
  ],
  [
    "not_found",
    /nosuchbucket|bucket (?:does not exist|not found)|directory not found|\b404\b|not ?found|nosuchkey|no such (?:file|bucket)/i,
  ],
  [
    "forbidden",
    /accessdenied|access denied|\b403\b|forbidden|permission denied|not authori[sz]ed to|insufficient permission|readonly|read-only/i,
  ],
  [
    "unreachable",
    /no such host|connection refused|connection reset|timeout|timed out|deadline exceeded|i\/o timeout|network is unreachable|tls:|x509|certificate|\beof\b|dial tcp|server misbehaving|temporary failure in name resolution|bad gateway|service unavailable|\b50[234]\b/i,
  ],
];

/** Which code a failure's stderr deserves. */
export function classify(stderr: string): BackupErrorCode {
  for (const [code, pattern] of PATTERNS) {
    if (pattern.test(stderr)) return code;
  }
  return "unknown";
}

/**
 * Makes rclone's words fit to store and show.
 *
 * Redacts, in this order: every secret the caller knows by value (the one
 * defence that does not depend on guessing what a secret looks like), then
 * anything that has the *shape* of one — a bearer token, an `access_token=`
 * pair, a URL's query string and userinfo. Then it keeps the last few lines,
 * since rclone's account of a failure is at the end, and trims to a length a
 * table cell can hold.
 */
export function scrub(
  text: string,
  secrets: readonly string[] = [],
  maxLength = 400,
): string {
  let out = text;
  for (const secret of secrets) {
    // Anything shorter is as likely to be a word in the sentence as a secret.
    if (secret.length >= 6) out = out.split(secret).join("•••");
  }
  out = out
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer •••")
    .replace(
      /\b(access_token|refresh_token|client_secret|password|pass|token|secret|signature|sig|key)=([^&\s"']+)/gi,
      "$1=•••",
    )
    .replace(/(\bhttps?:\/\/)[^/\s:@]+:[^/\s@]+@/gi, "$1•••@")
    .replace(/\?[^\s"']{20,}/g, "?•••")
    .replace(/\u001b\[[0-9;]*m/g, "");

  const lines = out
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const tail = lines.slice(-3).join(" · ");
  return tail.length > maxLength ? `${tail.slice(0, maxLength - 1)}…` : tail;
}
