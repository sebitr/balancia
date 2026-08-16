import "server-only";
import { logger } from "@/lib/logger";
import { incrementCounters } from "./counters";
import { counterKeysFor, type TelemetryEvent } from "./events";
import { buildUsageReport } from "./report";
import { recordSendOutcome, type EffectiveTelemetry } from "./settings";
import { sendUsageReport, type SendFailure } from "./transport";

/**
 * Three providers, one interface.
 *
 * The separation is the point: swapping which one is in use is the whole of
 * "turn telemetry off", and a fork that wants its installations to report
 * somewhere else — or nowhere at all — replaces one function here rather than
 * hunting for call sites in the domain. Nothing outside this directory knows
 * which provider is running.
 *
 *   null      — the default. Records nothing, sends nothing.
 *   local     — records counters in this instance's own database, and never
 *               transmits. What `TELEMETRY_MODE=local` selects, and what the
 *               administration preview reads.
 *   balancia  — records the same counters, and lets the weekly job transmit
 *               one aggregated report.
 *
 * Note where transmission is *not*: `track` never makes a network request in
 * any provider. Events become numbers locally; only the scheduled job in
 * `src/worker/run.ts` sends anything, once a week, in one request.
 */

export type ProviderName = "null" | "local" | "balancia";

export interface ReportOutcome {
  readonly status: "sent" | "failed" | "skipped";
  readonly reason?: SendFailure | "not-transmitting";
}

export interface TelemetryProvider {
  readonly name: ProviderName;
  /** Records one product event. Resolves even when it fails. */
  track(event: TelemetryEvent): Promise<void>;
  /** Called by the weekly job, and by the administrator's "send test report". */
  sendPeriodicReport(options?: { now?: Date }): Promise<ReportOutcome>;
}

/** Records nothing and sends nothing. What every installation has until asked. */
export class NullTelemetryProvider implements TelemetryProvider {
  readonly name = "null";

  async track(): Promise<void> {}

  async sendPeriodicReport(): Promise<ReportOutcome> {
    return { status: "skipped", reason: "not-transmitting" };
  }
}

/**
 * Records locally; transmits never.
 *
 * The counters it writes are this instance's own data, readable through the
 * administration preview and deleted when the switch goes off.
 */
export class LocalTelemetryProvider implements TelemetryProvider {
  readonly name = "local";

  async track(event: TelemetryEvent): Promise<void> {
    await incrementCounters(counterKeysFor(event));
  }

  async sendPeriodicReport(): Promise<ReportOutcome> {
    return { status: "skipped", reason: "not-transmitting" };
  }
}

/**
 * Records locally, and sends one aggregated report a week.
 *
 * Selected only when the deployment allows it *and* an administrator has
 * switched usage reporting on. The endpoint comes from configuration, not from
 * anything a user can type.
 */
export class BalanciaTelemetryProvider implements TelemetryProvider {
  readonly name = "balancia";

  constructor(private readonly endpoint: string) {}

  async track(event: TelemetryEvent): Promise<void> {
    await incrementCounters(counterKeysFor(event));
  }

  async sendPeriodicReport(
    options: { now?: Date } = {},
  ): Promise<ReportOutcome> {
    const report = await buildUsageReport({ now: options.now });
    const result = await sendUsageReport(report, { endpoint: this.endpoint });

    // Recorded so the administration page can say what happened last time
    // without the administrator having to read a log file.
    await recordSendOutcome(result.status === "sent" ? "sent" : "failed");

    if (result.status === "sent") {
      logger.info({ window: "7d" }, "Anonymous usage report sent");
      return { status: "sent" };
    }

    // Diagnosable locally, invisible to users: a report that did not go out
    // changes nothing about the application.
    logger.warn(
      { reason: result.reason },
      "Anonymous usage report could not be sent",
    );
    return { status: "failed", reason: result.reason };
  }
}

/** Chooses the provider that matches the resolved settings. */
export function providerFor(telemetry: EffectiveTelemetry): TelemetryProvider {
  if (!telemetry.recording) return new NullTelemetryProvider();
  if (!telemetry.transmitting) return new LocalTelemetryProvider();
  return new BalanciaTelemetryProvider(telemetry.endpoint);
}
