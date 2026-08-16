import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORED_SETTINGS,
  resolveTelemetry,
  type StoredTelemetrySettings,
  type TelemetryPolicy,
} from "./settings";

/**
 * Precedence between the deployment and the administrator.
 *
 * The rule under test is that the environment can only ever *subtract*. There
 * must be no combination of variables that starts sending data on an instance
 * whose administrator did not ask for it — that is the difference between
 * configuration and consent.
 */

const policy = (over: Partial<TelemetryPolicy> = {}): TelemetryPolicy => ({
  mode: "opt-in",
  crashReportsAllowed: true,
  endpoint: "https://telemetry.balancia.app",
  ...over,
});

const stored = (
  over: Partial<StoredTelemetrySettings> = {},
): StoredTelemetrySettings => ({ ...DEFAULT_STORED_SETTINGS, ...over });

describe("defaults", () => {
  it("records nothing and sends nothing on a fresh installation", () => {
    const settings = resolveTelemetry(policy(), stored());
    expect(settings.recording).toBe(false);
    expect(settings.transmitting).toBe(false);
    expect(settings.crashReporting).toBe(false);
  });

  it("leaves both switches usable, because the default is a ceiling not a state", () => {
    const settings = resolveTelemetry(policy(), stored());
    expect(settings.usageLocked).toBe(false);
    expect(settings.crashLocked).toBe(false);
  });
});

describe("the administrator's half", () => {
  it("starts recording and transmitting when usage reporting is switched on", () => {
    const settings = resolveTelemetry(
      policy(),
      stored({ usageReportingEnabled: true }),
    );
    expect(settings.recording).toBe(true);
    expect(settings.transmitting).toBe(true);
  });

  it("keeps crash reports off when only usage reporting was switched on", () => {
    const settings = resolveTelemetry(
      policy(),
      stored({ usageReportingEnabled: true }),
    );
    expect(settings.crashReporting).toBe(false);
  });

  it("keeps usage reporting off when only crash reports were switched on", () => {
    const settings = resolveTelemetry(
      policy(),
      stored({ crashReportingEnabled: true }),
    );
    expect(settings.recording).toBe(false);
    expect(settings.transmitting).toBe(false);
    expect(settings.crashReporting).toBe(true);
  });
});

describe("the deployment's half", () => {
  it("cannot switch anything on by itself", () => {
    // The property that matters most in this file: no combination of
    // environment values produces a sending instance on its own.
    for (const mode of ["opt-in", "local", "off"] as const) {
      for (const crashReportsAllowed of [true, false]) {
        const settings = resolveTelemetry(
          policy({ mode, crashReportsAllowed }),
          stored(),
        );
        expect(settings.recording, mode).toBe(false);
        expect(settings.transmitting, mode).toBe(false);
        expect(settings.crashReporting, mode).toBe(false);
      }
    }
  });

  it("records but never transmits in local mode", () => {
    const settings = resolveTelemetry(
      policy({ mode: "local" }),
      stored({ usageReportingEnabled: true, crashReportingEnabled: true }),
    );
    expect(settings.recording).toBe(true);
    expect(settings.transmitting).toBe(false);
    expect(settings.crashReporting).toBe(false);
    // Still adjustable: local mode is about where the data goes, not about
    // taking the decision away.
    expect(settings.usageLocked).toBe(false);
  });

  it("overrides a stored opt-in entirely when switched off", () => {
    const settings = resolveTelemetry(
      policy({ mode: "off" }),
      stored({ usageReportingEnabled: true, crashReportingEnabled: true }),
    );
    expect(settings.recording).toBe(false);
    expect(settings.transmitting).toBe(false);
    expect(settings.crashReporting).toBe(false);
    expect(settings.usageLocked).toBe(true);
    expect(settings.crashLocked).toBe(true);
  });

  it("can forbid crash reports alone", () => {
    const settings = resolveTelemetry(
      policy({ crashReportsAllowed: false }),
      stored({ usageReportingEnabled: true, crashReportingEnabled: true }),
    );
    expect(settings.transmitting).toBe(true);
    expect(settings.crashReporting).toBe(false);
    expect(settings.crashLocked).toBe(true);
    expect(settings.usageLocked).toBe(false);
  });
});

describe("the endpoint", () => {
  it("comes from the deployment and is passed through unchanged", () => {
    const settings = resolveTelemetry(
      policy({ endpoint: "https://telemetry.example.org/collect" }),
      stored({ usageReportingEnabled: true }),
    );
    expect(settings.endpoint).toBe("https://telemetry.example.org/collect");
  });

  it("is reported even when nothing may be sent, so the page can show it", () => {
    const settings = resolveTelemetry(policy({ mode: "off" }), stored());
    expect(settings.endpoint).toBe("https://telemetry.balancia.app");
  });
});

describe("what the administration page reads", () => {
  it("passes the stored settings through for display", () => {
    const changedAt = new Date("2026-08-01T10:00:00Z");
    const settings = resolveTelemetry(
      policy(),
      stored({
        usageReportingEnabled: true,
        usageReportingChangedAt: changedAt,
        lastReportSentAt: changedAt,
        lastReportStatus: "sent",
      }),
    );
    expect(settings.stored.usageReportingChangedAt).toBe(changedAt);
    expect(settings.stored.lastReportStatus).toBe("sent");
  });
});
