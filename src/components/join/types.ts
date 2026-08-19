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

export interface JoinExpenseView {
  readonly id: string;
  readonly description: string;
  readonly minorUnits: string;
  readonly currency: string;
}

export interface JoinMemberView {
  readonly id: string;
  readonly displayName: string;
  readonly expenseCount: number;
  readonly balances: readonly JoinMoney[];
  readonly recentExpenses: readonly JoinExpenseView[];
}

/**
 * Where the reader is.
 *
 * `confirm` and `match` share a step number, and `account` is reached from
 * either — from `confirm` when claiming, straight from `match` when adding
 * themselves — which is what the back map in the flow encodes.
 */
export type JoinScreen =
  "invite" | "name" | "match" | "confirm" | "account" | "done";

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
