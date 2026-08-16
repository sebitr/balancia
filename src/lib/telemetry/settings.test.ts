import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STORED_SETTINGS,
  resolveTelemetry,
  type StoredTelemetrySettings,
  type TelemetryPolicy,
} from "./settings";
import { TELEMETRY_ENDPOINT } from "./endpoint";

/**
 * Precedence between the deployment and the administrator.
 *
 * The environment sets two different kinds of thing, and most of what is
 * tested here is that they stay apart. `TELEMETRY_MODE` and
 * `TELEMETRY_CRASH_REPORTS` are ceilings: they can only subtract, and no value
 * of either starts anything. `TELEMETRY_DEFAULT` is a state, and the only one
 * — it says where the switches start, applies while nobody has answered, and
 * loses to the first administrator who answers.
 *
 * The rule that has to survive every combination below: an administrator's
 * answer, once given, beats the environment — including when the answer is no.
 */

const policy = (over: Partial<TelemetryPolicy> = {}): TelemetryPolicy => ({
  mode: "opt-in",
  crashReportsAllowed: true,
  defaultEnabled: false,
  endpoint: TELEMETRY_ENDPOINT,
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
  it("is the compiled-in constant, whatever the switches say", () => {
    // `resolveTelemetry` is pure and takes the policy it is given; what the
    // application passes is always the constant, which `telemetryPolicy`
    // supplies and `endpoint.test.ts` pins.
    for (const mode of ["opt-in", "local", "off"] as const) {
      const settings = resolveTelemetry(
        policy({ mode }),
        stored({ usageReportingEnabled: true }),
      );
      expect(settings.endpoint, mode).toBe(TELEMETRY_ENDPOINT);
    }
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

describe("the deployment's default", () => {
  // Any timestamp will do; what it means is that somebody answered.
  const answered = new Date("2026-08-16T12:00:00.000Z");

  it("starts both switches on when nobody has answered", () => {
    const settings = resolveTelemetry(
      policy({ defaultEnabled: true }),
      stored(),
    );
    expect(settings.usageEnabled).toBe(true);
    expect(settings.crashEnabled).toBe(true);
    expect(settings.recording).toBe(true);
    expect(settings.transmitting).toBe(true);
    expect(settings.crashReporting).toBe(true);
  });

  it("loses to an administrator who switched usage reporting off", () => {
    // The reason the timestamp exists at all: "answered: no" must not read as
    // "nobody has answered", or the switch in the UI would spring back on at
    // the next restart and there would be no way to turn telemetry off.
    const settings = resolveTelemetry(
      policy({ defaultEnabled: true }),
      stored({
        usageReportingEnabled: false,
        usageReportingChangedAt: answered,
      }),
    );
    expect(settings.usageEnabled).toBe(false);
    expect(settings.recording).toBe(false);
    expect(settings.transmitting).toBe(false);
  });

  it("treats the two switches as separate answers", () => {
    // Turning usage reporting off says nothing about crash reports, so the
    // default still stands for the switch nobody has touched.
    const settings = resolveTelemetry(
      policy({ defaultEnabled: true }),
      stored({
        usageReportingEnabled: false,
        usageReportingChangedAt: answered,
      }),
    );
    expect(settings.usageEnabled).toBe(false);
    expect(settings.crashEnabled).toBe(true);
  });

  it("only ever promotes, and never suppresses a switch stored as on", () => {
    // `enabled` with no timestamp is a row `setTelemetrySetting` never writes,
    // but a hand-edited row or an older backup can hold one. Reading it as
    // "undecided, so off" would quietly stop an instance that was reporting.
    const settings = resolveTelemetry(
      policy({ defaultEnabled: false }),
      stored({ usageReportingEnabled: true }),
    );
    expect(settings.usageEnabled).toBe(true);
    expect(settings.transmitting).toBe(true);
  });

  it("is still bounded by the mode, which sends nothing when off", () => {
    const settings = resolveTelemetry(
      policy({ defaultEnabled: true, mode: "off" }),
      stored(),
    );
    expect(settings.recording).toBe(false);
    expect(settings.transmitting).toBe(false);
    expect(settings.crashReporting).toBe(false);
  });

  it("records but transmits nothing in local mode", () => {
    const settings = resolveTelemetry(
      policy({ defaultEnabled: true, mode: "local" }),
      stored(),
    );
    expect(settings.recording).toBe(true);
    expect(settings.transmitting).toBe(false);
  });

  it("is still bounded by the crash-reports ceiling", () => {
    const settings = resolveTelemetry(
      policy({ defaultEnabled: true, crashReportsAllowed: false }),
      stored(),
    );
    expect(settings.transmitting).toBe(true);
    expect(settings.crashReporting).toBe(false);
  });

  it("says which switches nobody has answered for, so the UI can explain", () => {
    const fresh = resolveTelemetry(policy({ defaultEnabled: true }), stored());
    expect(fresh.usageUndecided).toBe(true);
    expect(fresh.crashUndecided).toBe(true);

    const decided = resolveTelemetry(
      policy({ defaultEnabled: true }),
      stored({ usageReportingChangedAt: answered }),
    );
    expect(decided.usageUndecided).toBe(false);
    expect(decided.crashUndecided).toBe(true);
  });
});

describe("what the administration page renders", () => {
  /**
   * The page has to show where the switch actually stands, not the stored
   * column. With a deployment default of on and nobody having answered, those
   * two disagree — the column reads false while the instance is reporting —
   * and a toggle drawn from the column would be a page lying about its own
   * state, which is the same bug the landing page's privacy line once had.
   *
   * Read as text because the only thing that can go wrong is which field the
   * page picks, and that is visible in the source.
   */
  it("takes the switch positions from the resolved state, not the stored row", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/app/(app)/admin/telemetry/page.tsx"),
      "utf8",
    );

    expect(source).toMatch(/usageEnabled=\{settings\.usageEnabled\}/);
    expect(source).toMatch(/crashEnabled=\{settings\.crashEnabled\}/);
    expect(source).not.toMatch(/Enabled=\{settings\.stored\./);
  });
});
