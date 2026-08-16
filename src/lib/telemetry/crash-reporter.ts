import "server-only";
import { logger } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { buildCrashReport, classifyError } from "./crash";
import type { CrashComponent } from "./schema";
import { getEffectiveTelemetry } from "./settings";
import { sendCrashReport } from "./transport";

/**
 * Crash reporting, which is a separate decision from usage reporting.
 *
 * Separate settings, separate transport call, separate endpoint, and separate
 * defaults — both off. An administrator who wants to help with feature
 * decisions but not with error triage (or the reverse) can have exactly that.
 *
 * What goes out is an error *class* and a component: `PostgresError_23505`,
 * `job`. Not the message, not the stack, not the request, not the query. See
 * `crash.ts` for why, and `docs/telemetry.md` for what is lost by it.
 *
 * Throttled twice over. Balancia sends at most one report per error class per
 * component per hour, and no more than a couple of dozen a day whatever
 * happens — because the interesting failure mode of an error reporter is the
 * one where an instance in a crash loop turns itself into a load generator
 * pointed at the collector.
 */

/** Errors this instance reports before the per-class throttle even applies. */
const DAILY_LIMIT_KEY = "instance";

export type CrashReportOutcome =
  "sent" | "disabled" | "throttled" | "failed" | "error";

/**
 * Reports one error, best-effort.
 *
 * Never throws and never rejects: every caller is already handling a failure,
 * and the reporter must not add a second one.
 */
export async function reportCrash(
  error: unknown,
  component: CrashComponent,
): Promise<CrashReportOutcome> {
  try {
    const settings = await getEffectiveTelemetry();
    if (!settings.crashReporting) return "disabled";

    const report = buildCrashReport(error, component);

    // Both keys are made of literals from a closed list — an error class name
    // that passed `classifyError`, and a component from the enum — so nothing
    // user-supplied is written to the rate-limit table.
    const perClass = await consumeRateLimit(
      "telemetryCrash",
      `${component}:${report.error}`,
    );
    if (!perClass.allowed) return "throttled";

    const perInstance = await consumeRateLimit(
      "telemetryCrashTotal",
      DAILY_LIMIT_KEY,
    );
    if (!perInstance.allowed) return "throttled";

    const result = await sendCrashReport(report, {
      endpoint: settings.endpoint,
    });

    if (result.status === "sent") return "sent";
    logger.debug(
      { reason: result.reason },
      "Anonymous crash report could not be sent",
    );
    return "failed";
  } catch (failure) {
    // An error inside the error reporter is a footnote in this instance's own
    // log and nothing more. Only the class name is logged, for the same reason
    // only the class name is ever sent.
    logger.debug({ err: classifyError(failure) }, "Crash reporting failed");
    return "error";
  }
}
