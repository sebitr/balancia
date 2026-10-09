import type { ProviderChoice } from "@/components/backup/provider-mark";
import type { BackupProvider } from "@/modules/backup/providers";
import type { Frequency } from "@/modules/backup/schedule";
import type { ProviderTile } from "@/modules/backup/view";

/**
 * What the setup page hands the wizard.
 *
 * Plain values only: the page reads `loadBackupScreen`, which is full of
 * `Date`s and views the browser has no use for, and passes down just enough
 * for four steps to draw themselves. Nothing here is a secret — a connection
 * waiting in `setup` is a row id and a label, never what was sealed with it.
 */

export const SETUP_STEPS = ["key", "where", "connect", "what"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export function isSetupStep(value: unknown): value is SetupStep {
  return (
    typeof value === "string" &&
    (SETUP_STEPS as readonly string[]).includes(value)
  );
}

/** A group the person owns, so one a backup can include. */
export interface SetupGroup {
  readonly id: string;
  readonly name: string;
  readonly participantCount: number;
  /** ISO instant, or null for a group nothing has happened in. */
  readonly lastActivityAt: string | null;
}

/** A connection the OAuth return made and step 4 has not finished. */
export interface SetupPending {
  readonly id: string;
  readonly provider: BackupProvider;
  /** "Google Drive · name@example.com". */
  readonly label: string;
}

/** The destination this setup stands in for, with the choices to start from. */
export interface SetupReplaced {
  readonly id: string;
  readonly provider: BackupProvider;
  readonly frequency: Frequency;
  readonly keepLast: number;
  readonly excludedGroupIds: readonly string[];
  readonly includeReceipts: boolean;
}

export interface SetupWizardProps {
  readonly step: SetupStep;
  /** The provider the address names, if it names one this server offers. */
  readonly provider: ProviderChoice | null;
  /** Whether a recovery key was already saved when the page was drawn. */
  readonly hasKey: boolean;
  /** A new key for an existing setup: one step, no strip, back to the overview. */
  readonly rotate: boolean;
  /** `connected=` named the connection that is waiting, and it is this provider's. */
  readonly connected: boolean;
  /** What the OAuth trip said, if it said anything: `denied`, `failed`, a code. */
  readonly connectOutcome: string | null;
  /** The connection waiting in `setup`, if there is one. */
  readonly pending: SetupPending | null;
  readonly replace: SetupReplaced | null;
  readonly providers: readonly ProviderTile[];
  readonly ownedGroups: readonly SetupGroup[];
}
