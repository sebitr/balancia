import type { NotificationType } from "@/modules/notifications/types";

/**
 * How sixteen rows of "something happened" become a list worth reading.
 *
 * Everything here is a pure function over the rows the server rendered. That
 * is deliberate: the inbox recomputes all of it on every filter change, every
 * dismissal and every mute, and none of those are worth a round trip. It also
 * means the rules below — which run collapses, which row prints a group chip,
 * where the imports end up — can be tested as arithmetic rather than by
 * driving a list with a pointer.
 *
 * The one thing this module does *not* decide is which calendar day a row
 * belongs to. That needs the reader's time zone and a clock, and both live on
 * the server; `day` therefore arrives already decided (see the page), so the
 * browser cannot disagree with the markup it was sent.
 */

/** Read notifications older than this stop counting as inbox and become archive. */
export const ARCHIVE_AFTER_DAYS = 30;

export type DaySection = "today" | "yesterday" | "earlier";

/** The three ways to narrow the list, in the order the control shows them. */
export const FILTERS = ["all", "unread", "reminders"] as const;
export type InboxFilter = (typeof FILTERS)[number];

/** One notification, with its wording already resolved on the server. */
export interface InboxRow {
  readonly id: string;
  readonly type: NotificationType;
  readonly groupId: string;
  readonly groupName: string;
  /** What the event happened *to*. Two rows sharing one are the same thread. */
  readonly entityId: string | null;
  /** Whoever caused it. Null for something the system did on a schedule. */
  readonly actor: string | null;
  /** The thing named in the sentence — an expense's description, where it has one. */
  readonly subject: string | null;
  /** A reminder's headline. Empty for every other kind. */
  readonly title: string;
  /** Actor, verb, object. The amount is not in here; it has a column. */
  readonly sentence: string;
  readonly amount: string | null;
  readonly url: string;
  readonly createdAt: string;
  readonly day: DaySection;
  readonly read: boolean;
}

/**
 * A reminder is a card, an import is a footnote, everything else is a row.
 *
 * Keyed off the notification type rather than off a flag on the row, so a new
 * type added to the enum has to come past here to get a shape.
 */
export function shapeOf(
  type: NotificationType,
): "reminder" | "import" | "activity" {
  if (type === "reminder.received") return "reminder";
  if (type === "import.completed") return "import";
  return "activity";
}

/** Whether an event badge is drawn over the avatar. Creating is the default case. */
export function isPlainCreation(type: NotificationType): boolean {
  return type === "expense.created";
}

export type InboxItem =
  | {
      readonly kind: "activity";
      readonly key: string;
      readonly row: InboxRow;
      readonly showChip: boolean;
    }
  | {
      /** Several changes to one thing by one person, folded into a line. */
      readonly kind: "burst";
      readonly key: string;
      readonly rows: readonly InboxRow[];
      readonly showChip: boolean;
    }
  | {
      readonly kind: "reminder";
      readonly key: string;
      readonly row: InboxRow;
    }
  | {
      /** Finished imports, gathered at the foot of their day. */
      readonly kind: "digest";
      readonly key: string;
      readonly rows: readonly InboxRow[];
    };

export interface InboxSection {
  readonly day: DaySection;
  readonly items: readonly InboxItem[];
}

export interface InboxCounts {
  readonly unread: number;
  readonly reminders: number;
}

/** Sections render in this order, and only when they have something in them. */
const DAY_ORDER: readonly DaySection[] = ["today", "yesterday", "earlier"];

export interface BuildOptions {
  readonly filter: InboxFilter;
  /** Swiped away in this session. */
  readonly dismissed?: readonly string[];
  /** Groups the reader has just muted or snoozed, before the server catches up. */
  readonly suppressedGroups?: readonly string[];
}

/**
 * The rows still worth showing: nothing swiped away, nothing from a group that
 * has been quietened.
 *
 * Both counts and sections are computed from this same set, which is what
 * makes "Unread 5" agree with the number of dots underneath it.
 */
export function visibleRows(
  rows: readonly InboxRow[],
  options: Pick<BuildOptions, "dismissed" | "suppressedGroups"> = {},
): InboxRow[] {
  const dismissed = new Set(options.dismissed ?? []);
  const suppressed = new Set(options.suppressedGroups ?? []);
  return rows.filter(
    (row) => !dismissed.has(row.id) && !suppressed.has(row.groupId),
  );
}

/** What the segmented control puts beside each label. */
export function countRows(rows: readonly InboxRow[]): InboxCounts {
  let unread = 0;
  let reminders = 0;
  for (const row of rows) {
    if (!row.read) unread += 1;
    if (shapeOf(row.type) === "reminder") reminders += 1;
  }
  return { unread, reminders };
}

function matchesFilter(row: InboxRow, filter: InboxFilter): boolean {
  if (filter === "unread") return !row.read;
  if (filter === "reminders") return shapeOf(row.type) === "reminder";
  return true;
}

/**
 * Whether two consecutive rows are the same person doing the same thing again.
 *
 * The sentence a burst renders — "Hervé made 3 changes to jardinier" — names
 * one actor, so the run has to be one actor's, or the line would be a claim
 * about somebody who was not there. Same-entity rows by two different people
 * therefore stay two rows, which is the honest outcome and the more
 * interesting one to read.
 */
function continuesBurst(row: InboxRow, previous: InboxRow): boolean {
  return (
    row.entityId !== null &&
    row.entityId === previous.entityId &&
    row.actor !== null &&
    row.actor === previous.actor
  );
}

/**
 * Folds runs of same-entity rows into bursts, leaving singles as they were.
 *
 * A run of one is not a burst: collapsing it would hide a sentence behind a
 * chevron for no gain.
 */
function collapseBursts(rows: readonly InboxRow[]): InboxRow[][] {
  const runs: InboxRow[][] = [];
  for (const row of rows) {
    const open = runs.at(-1);
    if (open && continuesBurst(row, open[0]!)) {
      open.push(row);
      continue;
    }
    runs.push([row]);
  }
  return runs;
}

/**
 * The list, sectioned by day and folded where folding helps.
 *
 * Order within a day is the order the rows arrived in — newest first — with
 * one exception: finished imports sink to the foot of their section. An import
 * is something the reader themselves set going and already knows about, so it
 * has no business interrupting the run of things other people did.
 */
export function buildSections(
  rows: readonly InboxRow[],
  options: BuildOptions,
): InboxSection[] {
  const kept = visibleRows(rows, options).filter((row) =>
    matchesFilter(row, options.filter),
  );

  const sections: InboxSection[] = [];

  for (const day of DAY_ORDER) {
    const inDay = kept.filter((row) => row.day === day);
    if (inDay.length === 0) continue;

    const imports = inDay.filter((row) => shapeOf(row.type) === "import");
    const rest = inDay.filter((row) => shapeOf(row.type) !== "import");

    const items: InboxItem[] = [];
    // A chip prints when the group changes, so the run has to be tracked
    // across the whole section — and starts empty at the top of each one.
    let runGroup: string | null = null;

    for (const run of collapseBursts(rest)) {
      const first = run[0]!;

      if (shapeOf(first.type) === "reminder") {
        items.push({ kind: "reminder", key: first.id, row: first });
        // A card is a break in the list, so the group underneath it names
        // itself again rather than trusting the reader to remember.
        runGroup = null;
        continue;
      }

      const showChip = first.groupId !== runGroup;
      runGroup = first.groupId;

      items.push(
        run.length > 1
          ? { kind: "burst", key: first.id, rows: run, showChip }
          : { kind: "activity", key: first.id, row: first, showChip },
      );
    }

    if (imports.length > 0) {
      items.push({ kind: "digest", key: imports[0]!.id, rows: imports });
    }

    sections.push({ day, items });
  }

  return sections;
}

/** Every row a section holds, bursts and digests unpacked. */
export function rowsOf(item: InboxItem): readonly InboxRow[] {
  return item.kind === "burst" || item.kind === "digest"
    ? item.rows
    : [item.row];
}
