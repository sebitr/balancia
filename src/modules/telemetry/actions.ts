"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getCurrentActor } from "@/lib/security/actor";
import { requireInstanceAdmin } from "@/lib/security/admin";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { RateLimitedError } from "@/lib/security/rate-limit";
import { telemetry } from "@/lib/telemetry";
import { clearCounters } from "@/lib/telemetry/counters";
import { providerFor } from "@/lib/telemetry/providers";
import {
  getEffectiveTelemetry,
  setTelemetrySetting,
} from "@/lib/telemetry/settings";
import type { ScanOutcome } from "@/lib/telemetry/events";

/**
 * The writes behind the administration page.
 *
 * Every one of them resolves the caller through `requireInstanceAdmin` first —
 * the page not being linked is not a permission check, and a Server Action is
 * an endpoint whether or not anything renders a button for it.
 *
 * The one exception is `recordReceiptScan`, which is not administration: it is
 * the single product event that happens in the browser rather than on the
 * server, and it is available to any signed-in participant.
 */

const TELEMETRY_PATH = "/admin/telemetry";

/**
 * Switches the weekly anonymous usage report on or off.
 *
 * Turning it off deletes the counters as well as stopping the reports.
 * "Off" should mean the data is gone, not merely unsent — otherwise a later
 * "on" would transmit a week that was recorded without consent.
 */
export async function setUsageReportingAction(
  enabled: boolean,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");
  const settings = await getEffectiveTelemetry({ fresh: true });
  if (settings.usageLocked) return actionError(t("telemetryLocked"));

  return runAction("setUsageReporting", async () => {
    await requireInstanceAdmin();
    await setTelemetrySetting("usage", enabled);
    if (!enabled) await clearCounters();
    revalidatePath(TELEMETRY_PATH);
  });
}

/** Switches anonymous crash reports on or off. Independent of the above. */
export async function setCrashReportingAction(
  enabled: boolean,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");
  const settings = await getEffectiveTelemetry({ fresh: true });
  if (settings.crashLocked) return actionError(t("telemetryLocked"));

  return runAction("setCrashReporting", async () => {
    await requireInstanceAdmin();
    await setTelemetrySetting("crash", enabled);
    revalidatePath(TELEMETRY_PATH);
  });
}

export interface TestReportResult {
  /** "sent" | "failed" — never a server-supplied message. */
  readonly status: "sent" | "failed" | "skipped";
  readonly reason?: string;
}

/**
 * Sends the report the preview is showing, now, because somebody pressed a
 * button.
 *
 * Never automatic: this is the only path that transmits outside the weekly
 * schedule, and it exists so an administrator can confirm that the request
 * actually leaves their network before trusting the switch above.
 *
 * The result says whether it worked and, if not, which of a fixed list of
 * reasons applied. It never carries a response body, a hostname or an
 * exception message — an administration page is not a place to learn what a
 * server's internals look like.
 */
export async function sendTestReportAction(): Promise<
  ActionResult<TestReportResult>
> {
  return runAction<TestReportResult>("sendTestTelemetryReport", async () => {
    const admin = await requireInstanceAdmin();

    const limit = await consumeRateLimit("telemetryTest", admin.userId);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);

    const settings = await getEffectiveTelemetry({ fresh: true });
    if (!settings.transmitting) {
      return { status: "skipped", reason: "disabled" };
    }

    const outcome = await providerFor(settings).sendPeriodicReport();
    return { status: outcome.status, reason: outcome.reason };
  });
}

/**
 * Records that a receipt was read on this device.
 *
 * The one event Balancia cannot observe on the server: recognition runs in the
 * browser, against models this instance serves, and the server never sees the
 * image or the text. What crosses the wire here is one word from a list of
 * three, and only for a signed-in participant.
 *
 * When telemetry is off — the default — this writes nothing at all; the call
 * still happens so that the browser does not have to be told whether the
 * instance is recording, which would be a fact about the operator sent to
 * every visitor.
 */
export async function recordReceiptScanAction(
  outcome: ScanOutcome,
): Promise<ActionResult> {
  const t = await getTranslations("serverErrors");
  const actor = await getCurrentActor();
  if (!actor) return actionError(t("signedInRequired"));

  return runAction("recordReceiptScan", async () => {
    await telemetry.receiptScanUsed({ outcome });
  });
}
