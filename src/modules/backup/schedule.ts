/**
 * When a destination is next due, and how patiently it is retried.
 *
 * Plain arithmetic on dates, kept apart from the database so that every rule
 * about timing can be tested without one.
 */

export type Frequency = "daily" | "weekly";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const PERIOD_MS: Readonly<Record<Frequency, number>> = {
  daily: DAY,
  weekly: 7 * DAY,
};

/**
 * Data that has not changed is still written this often.
 *
 * "Nothing changed, so nothing written" is right for a night in the middle of
 * a quiet month and wrong forever: someone who tidied their cloud folder, or
 * a provider that lost a file, would otherwise find that the one good copy is
 * the one that has gone, and that Balancia believes it is still there. A
 * fresh copy once a week bounds how long that can last.
 */
export const REWRITE_UNCHANGED_AFTER_MS = 7 * DAY;

/** The next scheduled run after a good one. */
export function nextRunAfter(from: Date, frequency: Frequency): Date {
  return new Date(from.getTime() + PERIOD_MS[frequency]);
}

export interface FinishInput {
  /** When the run began. */
  readonly startedAt: Date;
  /** When it ended. */
  readonly finishedAt: Date;
  /** `next_run_at` as the row holds it now, at the run's end. */
  readonly current: Date;
  /** When the run's outcome says the next should be. */
  readonly planned: Date;
}

/**
 * When the next run is due, once one has finished.
 *
 * Normally `planned`. But a run takes a while, and in that while the person
 * may have asked for one sooner — resumed the destination, switched receipts
 * on, reconnected, saved a new recovery key — each of which sets `next_run_at`
 * to the moment they did it. A due time that falls inside the run (after it
 * began, no later than its end) can only have been put there that way, since
 * a due time from before the run is what started it, or was in the future
 * when it was pressed. That request was made knowing nothing of this run's
 * result, and is kept, rather than pushed back a day by a run that began
 * before it.
 */
export function nextRunOnFinish(input: FinishInput): Date {
  const current = input.current.getTime();
  const askedForDuringRun =
    current > input.startedAt.getTime() &&
    current <= input.finishedAt.getTime();
  return askedForDuringRun ? input.current : input.planned;
}

/**
 * How long to wait after the `failures`th failure in a row: an hour, then two,
 * four, and so on, never more than a day.
 *
 * Retrying at once is how a revoked token or a full account is hammered, and
 * how a provider decides an integration is abusive; retrying once a month
 * leaves a backup silently broken. A day is the ceiling because a daily
 * schedule would be trying that often anyway.
 */
export function retryDelayMs(failures: number): number {
  const n = Math.max(1, Math.floor(failures));
  return Math.min(HOUR * 2 ** (n - 1), DAY);
}

export interface SkipInput {
  readonly trigger: "schedule" | "manual";
  readonly contentHash: string;
  readonly lastContentHash: string | null;
  readonly lastSuccessAt: Date | null;
  readonly now: Date;
}

/**
 * Whether a run may write nothing because nothing is different.
 *
 * Only a scheduled run does. Someone who presses "Back up now" wants a file in
 * their cloud, and a button that answers "already up to date" and leaves the
 * folder empty reads as broken.
 */
export function shouldSkipUnchanged(input: SkipInput): boolean {
  if (input.trigger === "manual") return false;
  if (input.lastContentHash === null || input.lastSuccessAt === null) {
    return false;
  }
  if (input.contentHash !== input.lastContentHash) return false;
  return (
    input.now.getTime() - input.lastSuccessAt.getTime() <
    REWRITE_UNCHANGED_AFTER_MS
  );
}
