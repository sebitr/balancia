import pino, { type DestinationStream, type LoggerOptions } from "pino";
import { errorForLog } from "./error-for-log";

/**
 * Structured application logging.
 *
 * Redaction is the point of centralizing this: financial software must never
 * leak a session token, an invitation token or a password into logs, and a
 * stray `logger.info({ req })` should not be able to do so by accident.
 *
 * Two mechanisms, because a secret can arrive two ways:
 *
 *  - **By key.** `REDACTED_PATHS` censors a value by where it sits in the
 *    object being logged — `password`, `token`, a request's cookie header.
 *  - **Inside an error.** A failed statement's message carries every value
 *    bound to it, and a key path cannot see into a string. Anything logged
 *    under `err` goes through `errorForLog` (`./error-for-log.ts`), which keeps
 *    the class, the SQLSTATE, the statement and the stack frames and drops the
 *    values. So the rule for a call site is to hand the logger the thrown value
 *    itself — `logger.error({ err: error }, "…")` — and never its `.message`
 *    or `.stack`, which `log-hygiene.test.ts` refuses.
 *
 * What neither can do is recognise a secret the code wrote under an innocent
 * key or into a message string of its own; that stays the call site's job.
 *
 * No external telemetry is configured, and none is added by default.
 */

const REDACTED_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "rawToken",
  "*.rawToken",
  "tokenHash",
  "*.tokenHash",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "AUTH_SECRET",
  "DATABASE_URL",
  "SMTP_PASSWORD",
  "S3_SECRET_ACCESS_KEY",
];

const level = process.env.LOG_LEVEL ?? "info";
const isDevelopment = process.env.NODE_ENV === "development";

const options: LoggerOptions = {
  level,
  redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  base: { service: "balancia" },
  serializers: {
    // A string is passed through: it is what the call site chose to write (the
    // crash reporter logs a class name this way). Anything thrown is reduced.
    err: (value: unknown) =>
      typeof value === "string" ? value : errorForLog(value),
  },
  hooks: {
    /*
     * Given an error and no message of its own — `logger.error(error)` — pino
     * writes the error's own message as the line's `msg`, which would put a
     * failed query's values back on the line the serializer has just cleaned.
     * Such a call is given the cleaned message instead.
     */
    logMethod(args, method) {
      if (args.length === 1) {
        const [first] = args as unknown[];
        const err =
          first instanceof Error
            ? first
            : typeof first === "object" &&
                first !== null &&
                (first as { msg?: unknown }).msg === undefined
              ? (first as { err?: unknown }).err
              : undefined;
        if (typeof err === "object" && err !== null) {
          return method.call(this, first as object, errorForLog(err).message);
        }
      }
      return method.apply(this, args);
    },
  },
};

/**
 * The logger, writing to `destination` when one is given — which only a test
 * does, to read back exactly what a call site would have written.
 */
export function createLogger(destination?: DestinationStream) {
  if (destination) return pino(options, destination);
  return pino({
    ...options,
    // Pretty output in development only; production emits newline-delimited
    // JSON that a log collector can parse.
    transport: isDevelopment
      ? {
          target: "pino-pretty",
          options: { colorize: true, singleLine: false },
        }
      : undefined,
  });
}

export const logger = createLogger();

export type Logger = typeof logger;
