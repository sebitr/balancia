import {
  TELEMETRY_SCHEMA_VERSION,
  type CrashComponent,
  type CrashReport,
} from "./schema";
import {
  appVersion,
  architecture,
  databaseKind,
  deploymentKind,
} from "./environment";

/**
 * Errors, reduced to the one thing about them that is safe to send.
 *
 * A crash report names an error *class* and the part of the system it came
 * from. It does not carry the message, the stack, the request, the query, the
 * parameters, the cause chain or anything else the exception was holding —
 * because all of those routinely contain exactly what telemetry must never
 * see. A `DatabaseError` message quotes the failing statement's parameters; a
 * `fetch` failure quotes the URL; an assertion quotes both sides of the
 * comparison.
 *
 * The classification below is therefore *allowlist-shaped*: it starts from
 * nothing and admits a candidate only if that candidate is already an
 * identifier. It never strips characters out of a rejected value and keeps
 * what is left — "john@example.com" with the punctuation removed is still an
 * address, and a sanitiser that produces `johnexamplecom` has leaked.
 *
 * See docs/telemetry.md for why stack traces are not transmitted at all.
 */

/** What is reported when nothing safe could be determined. */
const UNKNOWN = "UnknownError";

/** A JavaScript identifier, which is what every error class name is. */
const CLASS_NAME = /^[A-Za-z][A-Za-z0-9_]{2,63}$/;

/**
 * PostgreSQL's five-character SQLSTATE, e.g. `23505` (unique violation).
 *
 * Worth keeping: it is the difference between "the database said no" and "the
 * database was unreachable", it is defined by the standard rather than by any
 * data in the row, and it cannot contain a value from a query.
 */
const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Node's own error codes, e.g. `ECONNREFUSED`, `ENOSPC`.
 *
 * Constants from the runtime, upper case by convention and short by
 * definition. A disk that filled up and a push service that refused a
 * connection are the two most useful diagnoses a self-hosted install produces,
 * and neither is describable without this.
 */
const SYSTEM_CODE = /^E[A-Z0-9_]{2,20}$/;

function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function nameOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const named = error as { name?: unknown; constructor?: { name?: unknown } };
  const candidates = [named.name, named.constructor?.name];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    // Rejected whole, never repaired: see the note above.
    if (!CLASS_NAME.test(candidate)) continue;
    // "Error" is true of nearly everything and tells no one anything; prefer
    // the constructor if that is the more specific of the two.
    if (candidate === "Error" && named.constructor?.name !== "Error") continue;
    return candidate;
  }
  return null;
}

/**
 * Reduces any thrown value to a safe error class name.
 *
 * Exported for the tests, which feed it deliberately hostile errors.
 */
export function classifyError(error: unknown): string {
  const code = codeOf(error);

  if (code) {
    // pg reports every database failure as `name: "error"`, which classifies
    // nothing. The SQLSTATE is the real class.
    if (SQLSTATE.test(code)) return `PostgresError_${code}`;
    if (SYSTEM_CODE.test(code)) return `SystemError_${code}`;
  }

  return nameOf(error) ?? UNKNOWN;
}

/**
 * Builds the payload for one crash.
 *
 * The component is passed in by the call site as a literal from a closed list;
 * it is never derived from a module path, a route or a file name, because
 * those carry group and expense identifiers when they carry anything.
 */
export function buildCrashReport(
  error: unknown,
  component: CrashComponent,
): CrashReport {
  return {
    schema: TELEMETRY_SCHEMA_VERSION,
    version: appVersion(),
    error: classifyError(error),
    component,
    deployment: deploymentKind(),
    database: databaseKind(),
    architecture: architecture(),
  };
}
