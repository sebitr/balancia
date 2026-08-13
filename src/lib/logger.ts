import pino from "pino";

/**
 * Structured application logging.
 *
 * Redaction is the point of centralizing this: financial software must never
 * leak a session token, an invitation token or a password into logs, and a
 * stray `logger.info({ req })` should not be able to do so by accident.
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

export const logger = pino({
  level,
  redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  base: { service: "balancia" },
  // Pretty output in development only; production emits newline-delimited JSON
  // that a log collector can parse.
  transport: isDevelopment
    ? { target: "pino-pretty", options: { colorize: true, singleLine: false } }
    : undefined,
});

export type Logger = typeof logger;

/**
 * Child logger carrying a correlation identifier. Requests, jobs and import
 * runs each get one so a single operation can be followed across processes.
 */
export function withCorrelation(bindings: {
  requestId?: string;
  jobId?: string;
  importRunId?: string;
  groupId?: string;
  userId?: string;
}): Logger {
  return logger.child(bindings);
}
