/**
 * What the join screens are given.
 *
 * Every amount crosses from the server as a decimal string of minor units,
 * never as a number — the same rule the money components state — so these
 * mirror the service's types with `bigint` replaced by `string`.
 */

export interface JoinMoney {
  readonly currency: string;
  readonly minorUnits: string;
}

export interface JoinSummaryView {
  readonly groupName: string;
  readonly participantCount: number;
  readonly expenseCount: number;
  /** Already formatted by the server, in the reader's date notation. */
  readonly since: string | null;
  readonly totals: readonly JoinMoney[];
  /** Display names; the stack renders initials from them. */
  readonly faces: readonly string[];
}

/**
 * A name on the shared link's list, with what comes with it.
 *
 * The balance and the count are all a link-holder is shown about a name: the
 * row carries both, and that is what makes picking one checkable rather than a
 * guess at spelling. No expense is listed under it — the screen that did that
 * is gone, and what it showed was each expense's total rather than this
 * person's part of it, which no balance adds up from.
 */
export interface JoinMemberView {
  readonly id: string;
  readonly displayName: string;
  readonly expenseCount: number;
  /** Per currency; negative owes, positive gets back. Empty when settled. */
  readonly balances: readonly JoinMoney[];
}

/** Two letters where the name has two words, one where it does not. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + second).toUpperCase();
}

/** The name to greet somebody by on the done screen. */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}
