import { logger } from "@/lib/logger";
import { findForbiddenContent } from "./guard";
import {
  MAX_PAYLOAD_BYTES,
  crashReportSchema,
  usageReportSchema,
  type CrashReport,
  type UsageReport,
} from "./schema";

/**
 * Getting a payload out, best-effort.
 *
 * Four rules, and they are all about the same thing — telemetry is not allowed
 * to matter:
 *
 *  1. **It never throws.** Callers are background jobs and error handlers;
 *     an exception here would turn "the report did not send" into "the sweep
 *     crashed".
 *  2. **It never retries.** A weekly report that failed is a weekly report;
 *     the next one is seven days away and contains the same kind of thing. A
 *     retry loop across thousands of installations is a way to build an
 *     accidental denial of service against one's own collector.
 *  3. **It is timeboxed.** A collector that accepts a connection and then goes
 *     quiet must not hold a worker open.
 *  4. **It validates on the way out.** Twice: against the schema, and against
 *     a content scan that does not know the schema. See `guard.ts`.
 *
 * What is deliberately absent from the request: cookies, credentials, an
 * authorization header, an installation identifier, a nonce, a sequence
 * number, and any header that would let two requests be recognised as coming
 * from the same instance.
 */

/** Anything slower than this is a collector that is not answering. */
const TIMEOUT_MS = 5_000;

export type SendResult =
  | { readonly status: "sent" }
  | { readonly status: "failed"; readonly reason: SendFailure };

/**
 * Why a send did not happen, coarsely — for this instance's own log and for
 * the administration page. Never shown with a server-supplied string in it.
 */
export type SendFailure =
  | "invalid-payload"
  | "unsafe-payload"
  | "too-large"
  | "network"
  | "timeout"
  | "rejected"
  | "no-endpoint";

export interface SendOptions {
  readonly endpoint: string;
  /** Injected by tests. Defaults to the platform's `fetch`. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** POST /v1/report — the weekly anonymous usage report. */
export async function sendUsageReport(
  report: UsageReport,
  options: SendOptions,
): Promise<SendResult> {
  const parsed = usageReportSchema.safeParse(report);
  if (!parsed.success) return failed("invalid-payload");
  return post("/v1/report", parsed.data, options);
}

/** POST /v1/crash — one error classification. */
export async function sendCrashReport(
  report: CrashReport,
  options: SendOptions,
): Promise<SendResult> {
  const parsed = crashReportSchema.safeParse(report);
  if (!parsed.success) return failed("invalid-payload");
  return post("/v1/crash", parsed.data, options);
}

function failed(reason: SendFailure): SendResult {
  return { status: "failed", reason };
}

async function post(
  path: string,
  payload: object,
  options: SendOptions,
): Promise<SendResult> {
  if (!options.endpoint) return failed("no-endpoint");

  const forbidden = findForbiddenContent(payload);
  if (forbidden) {
    // A bug, and a serious one: something got into a payload that the schema
    // should not have allowed. Loud locally, and nothing goes out. The finding
    // names the rule and the path — never the value that tripped it.
    logger.error(
      { rule: forbidden.rule, path: forbidden.path },
      "Telemetry payload blocked before sending",
    );
    return failed("unsafe-payload");
  }

  const body = JSON.stringify(payload);
  if (Buffer.byteLength(body, "utf8") > MAX_PAYLOAD_BYTES) {
    return failed("too-large");
  }

  let url: string;
  try {
    url = new URL(path.replace(/^\//, ""), withTrailingSlash(options.endpoint))
      .href;
  } catch {
    return failed("no-endpoint");
  }

  const send = options.fetchImpl ?? fetch;
  try {
    const response = await send(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        // Deterministic and uninformative: the version is already in the
        // payload, where it is documented, and nothing else belongs here.
        "user-agent": "Balancia",
      },
      body,
      // A redirect is a collector asking to be followed somewhere this
      // instance did not agree to talk to. Refuse rather than follow.
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
      cache: "no-store",
    });

    // The body is never read. There is nothing a collector could say that this
    // instance would act on, and not reading it means a hostile or broken
    // response cannot become a parsing problem here.
    return response.ok ? { status: "sent" } : failed("rejected");
  } catch (error) {
    const name =
      error instanceof Error && typeof error.name === "string"
        ? error.name
        : "";
    return failed(name === "TimeoutError" ? "timeout" : "network");
  }
}

function withTrailingSlash(endpoint: string): string {
  return endpoint.endsWith("/") ? endpoint : `${endpoint}/`;
}
