import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { instanceSettings } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { TELEMETRY_ENDPOINT } from "./endpoint";

/**
 * Who decides whether telemetry happens, and in what order.
 *
 * Two authorities, and they are not equals:
 *
 *  - The **deployment** sets a ceiling with `TELEMETRY_MODE`, and the position
 *    the switches start in with `TELEMETRY_DEFAULT`. The ceiling can forbid
 *    and it can allow; the default applies only while nobody has decided.
 *  - The **administrator** sets the state within that ceiling, from Settings →
 *    Administration → Telemetry. The moment a switch is moved, that answer is
 *    stored with a timestamp and the deployment's default stops being
 *    consulted for it — on this installation and on every upgrade after.
 *
 * Effective state is the *intersection*: a thing happens only if the ceiling
 * allows it and the switch is on. That is why an operator can hand out
 * `TELEMETRY_MODE=off` and know it holds whatever anyone clicks.
 *
 * What `TELEMETRY_DEFAULT` gave up, stated plainly because it is a weaker
 * promise than this file used to make: an environment file *can* now start an
 * instance with telemetry on. What it cannot do is override an administrator
 * who has answered, or survive one answering afterwards. The setup wizard asks
 * the question out loud for exactly that reason — a default nobody was told
 * about would be the thing worth objecting to, not the default itself.
 *
 * See docs/telemetry.md.
 */

export type TelemetryMode = "opt-in" | "local" | "off";

/** The deployment's half of the decision. */
export interface TelemetryPolicy {
  readonly mode: TelemetryMode;
  readonly crashReportsAllowed: boolean;
  /**
   * The position both switches start in, until somebody moves one. Bounded by
   * the two settings above like any other state: `true` here with the mode
   * `off` still sends nothing.
   */
  readonly defaultEnabled: boolean;
  readonly endpoint: string;
}

/** The administrator's half, as stored. */
export interface StoredTelemetrySettings {
  readonly usageReportingEnabled: boolean;
  readonly crashReportingEnabled: boolean;
  readonly usageReportingChangedAt: Date | null;
  readonly crashReportingChangedAt: Date | null;
  readonly lastReportAttemptAt: Date | null;
  readonly lastReportSentAt: Date | null;
  readonly lastReportStatus: "sent" | "failed" | null;
}

/** What the rest of the application asks about. */
export interface EffectiveTelemetry {
  readonly mode: TelemetryMode;
  /**
   * Where the usage switch actually stands: what an administrator stored, or
   * the deployment's default while none has decided. This is what the
   * administration page must render — the stored column on its own would show
   * "off" on an instance that is reporting.
   */
  readonly usageEnabled: boolean;
  /** The crash switch's position, by the same rule. */
  readonly crashEnabled: boolean;
  /**
   * True while nobody has moved this switch, so the position above came from
   * the deployment's default rather than from somebody choosing it. The two
   * are different facts about consent — "on because the deployment asked for
   * it" is not "on because an administrator turned it on" — and only this can
   * tell them apart, since the position alone cannot.
   */
  readonly usageUndecided: boolean;
  readonly crashUndecided: boolean;
  /** Product counters are written to this instance's own database. */
  readonly recording: boolean;
  /** The weekly report may be transmitted. */
  readonly transmitting: boolean;
  /** Crash classifications may be transmitted. */
  readonly crashReporting: boolean;
  /** The administration switches cannot be moved, because the deployment said so. */
  readonly usageLocked: boolean;
  readonly crashLocked: boolean;
  readonly endpoint: string;
  readonly stored: StoredTelemetrySettings;
}

export const DEFAULT_STORED_SETTINGS: StoredTelemetrySettings = {
  usageReportingEnabled: false,
  crashReportingEnabled: false,
  usageReportingChangedAt: null,
  crashReportingChangedAt: null,
  lastReportAttemptAt: null,
  lastReportSentAt: null,
  lastReportStatus: null,
};

/**
 * Reads the deployment's half. Falls back to "off" if the environment is
 * unusable.
 *
 * The endpoint is not part of what it reads: it is a constant, so the only
 * question configuration answers is whether anything may be sent at all.
 */
export function telemetryPolicy(): TelemetryPolicy {
  try {
    const env = getEnv();
    return {
      mode: env.TELEMETRY_MODE,
      crashReportsAllowed: env.TELEMETRY_CRASH_REPORTS,
      defaultEnabled: env.TELEMETRY_DEFAULT,
      endpoint: TELEMETRY_ENDPOINT,
    };
  } catch {
    // Telemetry is the last thing that should keep a misconfigured instance
    // from starting, and "we could not read the configuration" resolves to
    // "send nothing" rather than to a guess. That has to include the default:
    // an unreadable environment must not be read as one that asked for this.
    return {
      mode: "off",
      crashReportsAllowed: false,
      defaultEnabled: false,
      endpoint: "",
    };
  }
}

/**
 * Combines the two halves. Pure, so the precedence rules are testable without
 * a database or an environment.
 */
export function resolveTelemetry(
  policy: TelemetryPolicy,
  stored: StoredTelemetrySettings,
): EffectiveTelemetry {
  const off = policy.mode === "off";

  // The timestamp is what separates "nobody has decided" from "decided: no".
  // It is null on a fresh row and set by `setTelemetrySetting` on every write,
  // so it answers the only question the default needs to ask, and it answers
  // it per switch — an administrator who turns usage reporting off has said
  // nothing about crash reports.
  const usageUndecided = stored.usageReportingChangedAt === null;
  const crashUndecided = stored.crashReportingChangedAt === null;

  // An OR rather than "default if undecided, stored otherwise", so the
  // deployment's default can only ever *promote* a switch that nobody has
  // touched. It cannot suppress one that is stored as on, which matters
  // because "enabled with no timestamp" is a state the schema permits even
  // though `setTelemetrySetting` never writes it — a row restored from an
  // older backup, or edited by hand, would otherwise be silently ignored.
  const usageEnabled =
    stored.usageReportingEnabled || (usageUndecided && policy.defaultEnabled);
  const crashEnabled =
    stored.crashReportingEnabled || (crashUndecided && policy.defaultEnabled);

  const usageOn = !off && usageEnabled;

  return {
    mode: policy.mode,
    usageEnabled,
    crashEnabled,
    usageUndecided,
    crashUndecided,
    // `local` records exactly as `opt-in` does. The difference is entirely in
    // what happens afterwards, which is nothing.
    recording: usageOn,
    transmitting: usageOn && policy.mode === "opt-in",
    // Crash reports have no local half worth keeping — an error that is not
    // being reported is already in this instance's log, in full, where it is
    // more use than a bucketed count would be.
    crashReporting:
      !off &&
      policy.mode === "opt-in" &&
      policy.crashReportsAllowed &&
      crashEnabled,
    usageLocked: off,
    crashLocked: off || !policy.crashReportsAllowed,
    endpoint: policy.endpoint,
    stored,
  };
}

/**
 * Short-lived cache of the stored half.
 *
 * Every recorded event asks whether telemetry is on, and the answer changes
 * about once a year. A few seconds of staleness after the switch moves is not
 * a privacy problem in the direction that matters — turning telemetry *off*
 * also drops the counters that were written, and the weekly job re-reads the
 * setting when it runs, so nothing is transmitted on the strength of a stale
 * "yes".
 */
const CACHE_TTL_MS = 5_000;

interface Cached {
  readonly value: StoredTelemetrySettings;
  readonly at: number;
}

let cache: Cached | undefined;

/** Test hook: forget the cached settings. */
export function resetTelemetrySettingsCache(): void {
  cache = undefined;
}

async function readStored(): Promise<StoredTelemetrySettings> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(instanceSettings)
    .where(eq(instanceSettings.id, 1))
    .limit(1);

  if (!row) return DEFAULT_STORED_SETTINGS;

  return {
    usageReportingEnabled: row.usageReportingEnabled,
    crashReportingEnabled: row.crashReportingEnabled,
    usageReportingChangedAt: row.usageReportingChangedAt,
    crashReportingChangedAt: row.crashReportingChangedAt,
    lastReportAttemptAt: row.lastReportAttemptAt,
    lastReportSentAt: row.lastReportSentAt,
    lastReportStatus: row.lastReportStatus,
  };
}

/** The stored half, cached for a few seconds. */
export async function getStoredSettings(options: { fresh?: boolean } = {}) {
  if (!options.fresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return cache.value;
  }
  const value = await readStored();
  cache = { value, at: Date.now() };
  return value;
}

/**
 * The question every caller actually has: what is telemetry allowed to do?
 *
 * Never throws. A database that cannot be reached resolves to "off", because
 * an instance that cannot read its own settings must not act on a guess about
 * consent.
 */
export async function getEffectiveTelemetry(
  options: { fresh?: boolean } = {},
): Promise<EffectiveTelemetry> {
  const policy = telemetryPolicy();
  if (policy.mode === "off") {
    // Nothing to read: the answer cannot depend on the database.
    return resolveTelemetry(policy, DEFAULT_STORED_SETTINGS);
  }

  try {
    return resolveTelemetry(policy, await getStoredSettings(options));
  } catch {
    return resolveTelemetry(
      { ...policy, mode: "off" },
      DEFAULT_STORED_SETTINGS,
    );
  }
}

/**
 * Moves one of the two switches.
 *
 * Authorization happens above this, in the Server Action — this function is
 * the write, not the decision about who may make it.
 */
export async function setTelemetrySetting(
  which: "usage" | "crash",
  enabled: boolean,
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const db = getDb();

  const values =
    which === "usage"
      ? {
          usageReportingEnabled: enabled,
          usageReportingChangedAt: now,
          updatedAt: now,
        }
      : {
          crashReportingEnabled: enabled,
          crashReportingChangedAt: now,
          updatedAt: now,
        };

  await db
    .insert(instanceSettings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: instanceSettings.id, set: values });

  cache = undefined;
}

/** Records the outcome of a transmission attempt, for the administration page. */
export async function recordSendOutcome(
  status: "sent" | "failed",
  options: { now?: Date } = {},
): Promise<void> {
  const now = options.now ?? new Date();
  const db = getDb();
  const values = {
    lastReportAttemptAt: now,
    lastReportStatus: status,
    ...(status === "sent" ? { lastReportSentAt: now } : {}),
    updatedAt: now,
  };

  await db
    .insert(instanceSettings)
    .values({ id: 1, ...values })
    .onConflictDoUpdate({ target: instanceSettings.id, set: values });

  cache = undefined;
}
