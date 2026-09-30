import { SQLSTATE, SYSTEM_CODE, classifyError } from "@/lib/telemetry/crash";

/**
 * Errors, reduced to what this instance may write to its own log.
 *
 * A failed statement is the dangerous one. Drizzle wraps every driver failure
 * in a `DrizzleQueryError` whose message is the statement *followed by every
 * value bound to it*, so a refused sign-up puts the address and the password
 * hash on one line and a refused expense its description and amount. The
 * driver's error underneath is no better: a unique violation's `detail` reads
 * `Key (email)=(…) already exists.`, and a value PostgreSQL could not read is
 * quoted back in the message itself. The logger's redaction works on key
 * paths, so it cannot see any of this — it is text inside a string.
 *
 * `telemetry/crash.ts` answers the same problem for crash reports by keeping
 * nothing but the class. A log is read by this instance's own administrator
 * and has to say more than that, so this keeps everything about an error
 * except the values it carries out of a row:
 *
 *  - An error that is not the database's keeps its class, message, code and
 *    stack, as it always did.
 *  - A database error keeps its class, its SQLSTATE, the names PostgreSQL
 *    reported it against (table, column, constraint), the statement with its
 *    `$1` placeholders, and the frames of its stack. It loses the bound
 *    parameters, `detail`, `hint` and `where`, and its message too unless the
 *    SQLSTATE is in a class whose messages are built from names alone.
 *  - An error that quoted a database error's message into its own — a failed
 *    migration does — has the quotation replaced by the safe version.
 *
 * The statement text is safe because Drizzle sends every value as a bound
 * parameter; `sql.raw` is the one way to write a value into the text itself,
 * and nothing in `src/` uses it. The class is `classifyError`'s, so a log line
 * and a crash report name one failure the same way.
 */

/**
 * SQLSTATE classes whose messages PostgreSQL composes from identifiers alone.
 *
 * `duplicate key value violates unique constraint "users_email_key"`, `column
 * "amount" does not exist`, `deadlock detected`, `canceling statement due to
 * statement timeout`: each names a table, a column or a constraint and nothing
 * that was in a row. Class 22 is why this is a list rather than a rule —
 * `invalid input syntax for type uuid: "…"` quotes the value it refused. A
 * `RAISE` in PL/pgSQL can say anything under any code, which is safe here only
 * because Balancia's schema raises nothing.
 */
const NAMING_CLASSES = new Set([
  "08", // connection exception
  "23", // integrity constraint violation
  "25", // invalid transaction state
  "40", // transaction rollback: serialization failure, deadlock
  "42", // syntax error or access rule violation: no such table or column
  "53", // insufficient resources: disk full, too many connections
  "57", // operator intervention: statement timeout, shutdown
]);

/**
 * The fields pg copies out of PostgreSQL's error report that name a schema
 * object rather than quote a row. Each is kept only if it is an identifier,
 * and rejected whole otherwise — never trimmed into one, for the reason given
 * in `crash.ts`.
 */
const NAMED_FIELDS = [
  "severity",
  "schema",
  "table",
  "column",
  "dataType",
  "constraint",
  "routine",
] as const;

/** An unquoted PostgreSQL identifier, which is at most 63 bytes. */
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;

/** How far down a `cause` chain to follow. Drizzle nests one level. */
const MAX_DEPTH = 5;

type NamedField = (typeof NAMED_FIELDS)[number];

export type LoggedError = {
  readonly type: string;
  readonly message: string;
  readonly stack?: string;
  readonly code?: string;
  readonly query?: string;
  readonly cause?: LoggedError;
} & { readonly [field in NamedField]?: string };

/** A database message as raised, and the version of it that may be logged. */
type Quotation = readonly [raw: string, safe: string];

/**
 * Turns any thrown value into an object that is safe to log.
 *
 * Installed as the logger's `err` serializer, so `logger.error({ err })` goes
 * through it without the call site having to know.
 */
export function errorForLog(error: unknown): LoggedError {
  const chain = causeChain(error);
  const quotations = chain.flatMap(quotationOf);

  let logged: LoggedError | undefined;
  for (const level of chain.toReversed()) {
    logged = describe(level, quotations, logged);
  }
  // `causeChain` always returns at least the error itself.
  return logged!;
}

/** Whether the value, or anything in its `cause` chain, is a database error. */
export function holdsDatabaseError(error: unknown): boolean {
  return causeChain(error).some(isDatabaseError);
}

const guarded = new WeakSet<object>();

/**
 * Keeps a failed query's values out of what Next.js prints for itself.
 *
 * An error that escapes a page or a route handler never reaches the logger:
 * Next.js writes it to stderr with `console.error` just after handing it to
 * `onRequestError`, and Node prints an error's own properties along with its
 * stack — Drizzle's `params` among them, and the driver's `detail` under
 * `[cause]`. This swaps such an argument for the same error rebuilt from
 * `errorForLog`, and passes every other argument through untouched.
 *
 * Installed once, from `register` in `src/instrumentation.ts`.
 */
export function guardConsoleErrors(
  target: Pick<Console, "error"> = console,
): void {
  if (guarded.has(target)) return;
  guarded.add(target);
  const original = target.error;
  target.error = (...args: unknown[]) =>
    original.apply(
      target,
      args.map((arg) =>
        holdsDatabaseError(arg) ? rebuild(errorForLog(arg), arg) : arg,
      ),
    );
}

/**
 * A real `Error` again, so Node formats it as one: the safe stack, the safe
 * fields beside it, and the cause beneath.
 */
function rebuild(logged: LoggedError, original?: unknown): Error {
  const { type, message, stack, cause, ...fields } = logged;
  const error = new Error(
    message,
    cause ? { cause: rebuild(cause) } : undefined,
  );
  error.name = type;
  error.stack = stack ?? `${type}: ${message}`;
  Object.assign(error, fields);
  // The digest is how a reader's "something went wrong" page is matched to
  // this line; it is a hash, and worth keeping.
  const digest = isRecord(original) ? original.digest : undefined;
  if (typeof digest === "string" && /^[\w@-]{1,64}$/.test(digest)) {
    Object.assign(error, { digest });
  }
  return error;
}

function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [error];
  let current = error;
  while (chain.length < MAX_DEPTH && isRecord(current)) {
    const cause = current.cause;
    if (cause === undefined || cause === null || chain.includes(cause)) break;
    chain.push(cause);
    current = cause;
  }
  return chain;
}

function describe(
  value: unknown,
  quotations: readonly Quotation[],
  cause: LoggedError | undefined,
): LoggedError {
  const type = classifyError(value);
  const tail = cause ? { cause } : {};

  if (!isRecord(value)) {
    return { type, message: scrub(String(value), quotations), ...tail };
  }

  const raw = textOf(value.message);
  const stack = textOf(value.stack);
  const code = codeOf(value);

  if (!isDatabaseError(value)) {
    return {
      type,
      message: scrub(raw ?? "", quotations),
      ...(stack === undefined ? {} : { stack: scrub(stack, quotations) }),
      ...(code === undefined ? {} : { code }),
      ...tail,
    };
  }

  const message = databaseMessage(value);
  const frames = framesAfter(stack, raw);
  const named: { [field in NamedField]?: string } = {};
  for (const field of NAMED_FIELDS) {
    const candidate = value[field];
    if (typeof candidate === "string" && IDENTIFIER.test(candidate)) {
      named[field] = candidate;
    }
  }

  return {
    type,
    message,
    // The header is rebuilt from the safe message; only the frames, which are
    // code, are kept from the original.
    ...(frames === undefined ? {} : { stack: `${type}: ${message}${frames}` }),
    ...(code === undefined ? {} : { code }),
    ...(typeof value.query === "string" ? { query: value.query } : {}),
    ...named,
    ...tail,
  };
}

/**
 * Drizzle's wrapper and PGlite's own errors carry the statement and the values
 * bound to it; pg's `DatabaseError` carries a severity beside its SQLSTATE,
 * which is what tells it apart from a Node error whose code happens to be five
 * capitals, like `EPIPE`.
 */
function isDatabaseError(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if ("params" in value || typeof value.query === "string") return true;
  return (
    typeof value.severity === "string" &&
    typeof value.code === "string" &&
    SQLSTATE.test(value.code)
  );
}

function databaseMessage(value: Record<string, unknown>): string {
  const code = typeof value.code === "string" ? value.code : "";
  const raw = textOf(value.message);
  if (SQLSTATE.test(code)) {
    if (raw !== undefined && NAMING_CLASSES.has(code.slice(0, 2))) return raw;
    return `Database error ${code} (message withheld: it can quote a value)`;
  }
  // Drizzle's wrapper has no code of its own; the driver's error is its cause.
  return typeof value.query === "string"
    ? "Failed query"
    : "Database error (message withheld: it can quote a value)";
}

function quotationOf(level: unknown): Quotation[] {
  if (!isDatabaseError(level)) return [];
  const raw = textOf(level.message);
  const safe = databaseMessage(level);
  return raw && raw !== safe ? [[raw, safe]] : [];
}

/** Replaces every database message a wrapper quoted with its safe version. */
function scrub(text: string, quotations: readonly Quotation[]): string {
  return quotations.reduce(
    (result, [raw, safe]) => result.replaceAll(raw, safe),
    text,
  );
}

/**
 * The stack's frames, without the header that repeats the message.
 *
 * Found by the message itself rather than by the first line that looks like a
 * frame: Drizzle's message runs over two lines, and a bound value can contain
 * a newline followed by anything at all. If the message is not where it
 * should be, no stack is kept.
 */
function framesAfter(
  stack: string | undefined,
  message: string | undefined,
): string | undefined {
  if (stack === undefined) return undefined;
  if (!message) {
    const newline = stack.indexOf("\n");
    return newline === -1 ? "" : stack.slice(newline);
  }
  const at = stack.indexOf(message);
  return at === -1 ? undefined : stack.slice(at + message.length);
}

/** A SQLSTATE or a Node system code — the two kinds that name, not quote. */
function codeOf(value: Record<string, unknown>): string | undefined {
  const code = value.code;
  return typeof code === "string" &&
    (SQLSTATE.test(code) || SYSTEM_CODE.test(code))
    ? code
    : undefined;
}

function textOf(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
