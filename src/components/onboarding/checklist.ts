/**
 * "Finish setting up", as data.
 *
 * Everything the old questionnaire asked before the door — currencies, formats,
 * notifications, payout details — is here instead, behind the balance rather
 * than in front of it. What makes that work is that the list is honest about
 * two things at once: what is left, and what already happened.
 *
 * So a row carries a note that is a receipt, not a restatement of its label.
 * "Account created / Passkey saved to this phone" tells somebody which of the
 * two ways in they actually took, which is the thing they will need to
 * remember on their next device. A row that merely repeated its own title
 * would be furniture.
 *
 * Three markers, and the glyph carries the state rather than the colour:
 *
 *  - `done` — a filled positive circle with a check.
 *  - `todo` — a pale circle with a barely-there check.
 *  - `urgent` — a hollow ring with an arrow, never a filled check. A coral
 *    check would read as complete-and-important, and in greyscale would be
 *    indistinguishable from done. Only one row is ever urgent: a guest's
 *    unclaimed account, which is the single thing on the list that can be lost
 *    by closing the browser.
 */

export type ChecklistMarker = "done" | "todo" | "urgent";

export type ChecklistSheet =
  | "claimAccount"
  | "profile"
  | "passkey"
  | "payouts"
  | "currencies"
  | "notifications";

export interface ChecklistRow {
  readonly id: string;
  readonly marker: ChecklistMarker;
  /** Catalogue key under `onboarding.checklist`. */
  readonly labelKey: string;
  readonly noteKey: string;
  readonly noteValues?: Readonly<Record<string, string | number>>;
  /** What tapping it opens. Completed rows open nothing. */
  readonly sheet: ChecklistSheet | null;
}

export interface ChecklistState {
  readonly isGuest: boolean;
  /** How the account was proved, for the receipt on the first row. */
  readonly credential: "passkey" | "code" | "password" | null;
  readonly email: string | null;
  readonly hasPhoto: boolean;
  /** A passkey on the account already, on this device or another. */
  readonly hasPasskey: boolean;
  /** One was added from this very list, so its row stays as the receipt. */
  readonly passkeyAdded: boolean;
  /** Whether this browser could register one at all. */
  readonly passkeysSupported: boolean;
  readonly name: string;
  /** Ordered, first is the default. Empty until they are asked. */
  readonly currencies: readonly string[];
  /** Labels of the payout methods entered, in order. */
  readonly payouts: readonly string[];
  /** How many of the five notification kinds are on. */
  readonly notificationsOn: number;
  readonly notificationCount: number;
  readonly pushEnabled: boolean;
}

export function checklistRows(state: ChecklistState): readonly ChecklistRow[] {
  const account: ChecklistRow = state.isGuest
    ? {
        id: "account",
        marker: "urgent",
        labelKey: "claimLabel",
        noteKey: "claimNote",
        sheet: "claimAccount",
      }
    : {
        id: "account",
        marker: "done",
        labelKey: "accountLabel",
        // Which credential ran is the part worth keeping: it is what this
        // person will look for when they open Balancia somewhere else.
        noteKey:
          state.credential === "passkey"
            ? "accountNotePasskey"
            : state.email
              ? "accountNoteVerified"
              : "accountNotePassword",
        noteValues: state.email ? { email: state.email } : undefined,
        sheet: null,
      };

  /*
   * Name and photo, for an account. A guest has no account to hang a photo
   * on, so for them the row is not merely unfinishable but meaningless, and
   * it is left out rather than shown as a thing still to do.
   */
  const profile: ChecklistRow | null = state.isGuest
    ? null
    : {
        id: "profile",
        marker: state.hasPhoto ? "done" : "todo",
        labelKey: "profileLabel",
        noteKey: state.hasPhoto ? "profileNotePhoto" : "profileNoteInitials",
        noteValues: { name: state.name },
        // A finished row opens nothing; an unfinished one opens the sheet
        // that finishes it. Before, this row could never be tapped at all.
        sheet: state.hasPhoto ? null : "profile",
      };

  /*
   * A passkey for the next sign-in.
   *
   * Offered to an account that came in by a code, on a browser that can
   * register one: the moment after a successful sign-in is where most passkey
   * enrolments come from, and it is the one thing on this list that makes the
   * next device a tap rather than an inbox. Not shown where the account
   * already came in with a passkey — the account row says so — nor to a guest,
   * who has no account to attach one to, nor to an account that already has
   * one somewhere: a list is for what is left, and a done row is only kept
   * when it was this list that did it.
   */
  const passkey: ChecklistRow | null =
    state.isGuest ||
    state.credential === "passkey" ||
    !state.passkeysSupported ||
    (state.hasPasskey && !state.passkeyAdded)
      ? null
      : {
          id: "passkey",
          marker: state.hasPasskey ? "done" : "todo",
          labelKey: "passkeyLabel",
          noteKey: state.hasPasskey ? "passkeyNoteDone" : "passkeyNote",
          sheet: state.hasPasskey ? null : "passkey",
        };

  const payouts: ChecklistRow = {
    id: "payouts",
    marker: state.payouts.length > 0 ? "done" : "todo",
    labelKey: "payoutsLabel",
    noteKey: state.payouts.length > 0 ? "payoutsNoteSet" : "payoutsNoteEmpty",
    noteValues:
      state.payouts.length > 0
        ? { methods: state.payouts.join(" · ") }
        : undefined,
    sheet: "payouts",
  };

  const currencies: ChecklistRow = {
    id: "currencies",
    marker: state.currencies.length > 0 ? "done" : "todo",
    labelKey: "currenciesLabel",
    noteKey:
      state.currencies.length > 0 ? "currenciesNoteSet" : "currenciesNoteEmpty",
    noteValues:
      state.currencies.length > 0
        ? { codes: state.currencies.join(" · ") }
        : undefined,
    sheet: "currencies",
  };

  const notifications: ChecklistRow = {
    id: "notifications",
    // Being asked is what completes this row, and being asked is what having a
    // device subscription proves. The switches above it all default to on, so
    // counting them would mark it done before anybody had seen it.
    marker: state.pushEnabled ? "done" : "todo",
    labelKey: "notificationsLabel",
    noteKey: state.pushEnabled
      ? "notificationsNotePushed"
      : "notificationsNoteInApp",
    noteValues: {
      on: state.notificationsOn,
      total: state.notificationCount,
    },
    sheet: "notifications",
  };

  return [account, passkey, profile, payouts, currencies, notifications].filter(
    (row): row is ChecklistRow => row !== null,
  );
}

/**
 * Nothing on the list is outstanding.
 *
 * Asked before the screen is reached rather than on it, because a checklist
 * with every row already ticked is a screen that exists only to be dismissed.
 * Derived from the rows rather than from the state so that a row added later
 * is counted here without anybody remembering to; `urgent` is not done, which
 * is what keeps a guest's unclaimed account from completing the list.
 */
export function checklistIsComplete(state: ChecklistState): boolean {
  return checklistRows(state).every((row) => row.marker === "done");
}

/** How the header counts itself: "2 of 5". */
export function checklistProgress(rows: readonly ChecklistRow[]): {
  done: number;
  total: number;
} {
  return {
    done: rows.filter((row) => row.marker === "done").length,
    total: rows.length,
  };
}
