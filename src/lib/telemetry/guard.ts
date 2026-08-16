/**
 * The last thing that runs before a payload leaves the process.
 *
 * The schemas in `schema.ts` are the real guarantee: no field they define can
 * hold a description, an address or an identifier. This is the belt to that
 * pair of braces — a content scan that knows nothing about the schema and asks
 * only one question of every key and every string in the object: *does this
 * look like data about a person?*
 *
 * It exists because the schema is a thing a future change can edit. A field
 * added in good faith — "just the route path", "just the error message" —
 * passes validation the moment it is declared. It does not pass this.
 *
 * A trip is a bug, not a user-facing condition: the payload is dropped and the
 * rule is logged locally by the caller. Never the payload.
 */

export interface ForbiddenContent {
  /** Which rule tripped, e.g. "email". Safe to log. */
  readonly rule: string;
  /** Where it was found, as a dotted path. Contains no values. */
  readonly path: string;
}

/**
 * The longest string any telemetry field may contain.
 *
 * Every legitimate value is a bucket label, an enum member or a version, and
 * the longest of those (`docker-compose`) is fourteen characters. Thirty-two
 * leaves room to add one without loosening this, and is still far short of a
 * sentence — because anything sentence-shaped is somebody's data.
 */
const MAX_STRING_LENGTH = 32;

/** Deepest nesting a payload may have. Reports are two levels; this allows four. */
const MAX_DEPTH = 6;

const RULES: readonly { readonly name: string; readonly test: RegExp }[] = [
  { name: "email", test: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  // Any scheme, so an instance URL, a database DSN and an S3 endpoint are all
  // one rule. Balancia's own reports contain no URL of any kind.
  { name: "url", test: /[a-z][a-z0-9+.-]*:\/\//i },
  { name: "credential", test: /\b(bearer|authorization|cookie)\b/i },
  {
    name: "secret",
    test: /\b(password|passwd|secret|token|api[_-]?key|credential)s?\b/i,
  },
  // Any of Balancia's primary keys, which are all UUIDs.
  {
    name: "uuid",
    test: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
  },
  // Six digits in a row is an amount in minor units, a timestamp, or a row
  // count somebody forgot to bucket. Versions and bucket labels are shorter.
  { name: "long-number", test: /\d{6,}/ },
  // A path or a query string: neither can appear in a report, and both carry
  // group and expense identifiers when they appear anywhere else.
  { name: "path", test: /[/\\?&=]/ },
];

/**
 * Rules for *names* rather than values.
 *
 * Matched as substrings, without word boundaries, because the names in
 * question are camelCase: `\btoken\b` does not match `sessionToken`, which is
 * exactly the field this is looking for. A key that names a secret is a
 * finding even when this particular instance happened to send an empty one.
 */
const KEY_RULES: readonly { readonly name: string; readonly test: RegExp }[] = [
  {
    name: "secret",
    test: /(password|passwd|secret|token|api[_-]?key|credential|cookie|authorization|bearer)/i,
  },
  {
    name: "address",
    test: /(ip[_-]?address|hostname|instanceurl|instance_url)/i,
  },
];

/**
 * Walks a payload and returns the first thing that must not be transmitted.
 *
 * Keys are checked as well as values: a field *named* `sessionToken` is a
 * finding even when this particular instance happens to have sent an empty
 * one.
 */
export function findForbiddenContent(
  payload: unknown,
  path = "$",
  depth = 0,
): ForbiddenContent | null {
  if (depth > MAX_DEPTH) {
    return { rule: "too-deep", path };
  }

  if (payload === null || payload === undefined) return null;

  if (typeof payload === "string") {
    // Specific rules first, so a finding names the most useful reason it was
    // refused; length is the catch-all for everything shaped like prose.
    for (const rule of RULES) {
      if (rule.test.test(payload)) return { rule: rule.name, path };
    }
    if (payload.length > MAX_STRING_LENGTH) {
      return { rule: "too-long", path };
    }
    return null;
  }

  if (typeof payload === "number") {
    return Number.isFinite(payload) ? null : { rule: "not-a-number", path };
  }

  if (typeof payload === "boolean") return null;

  if (Array.isArray(payload)) {
    for (const [index, item] of payload.entries()) {
      const found = findForbiddenContent(item, `${path}[${index}]`, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (typeof payload === "object") {
    for (const [key, value] of Object.entries(payload)) {
      for (const rule of KEY_RULES) {
        if (rule.test.test(key)) {
          return { rule: `key:${rule.name}`, path: `${path}.${key}` };
        }
      }
      const found = findForbiddenContent(value, `${path}.${key}`, depth + 1);
      if (found) return found;
    }
    return null;
  }

  // Functions, symbols, bigints: nothing that should ever reach a payload.
  return { rule: `unsupported:${typeof payload}`, path };
}
