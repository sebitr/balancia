import { SPLIT_METHODS, type SplitMethod } from "@/modules/expenses/split";

/**
 * A group's saved split, and the reasons it is not simply trusted.
 *
 * "We always split 30/30/40" is the most-asked-for thing in this category,
 * and re-entering a fixed uneven split on every entry is the actual grind.
 * So the split sheet can save one — but what it saves names *people*, and
 * people leave groups.
 *
 * Two rules follow, and both are about the gap between when it was written
 * and when it is read:
 *
 *  - **It is filtered against the real roster, never trusted.** A default
 *    naming somebody who has since been removed would seed a split with a
 *    participant the server refuses, on an entry nobody had touched.
 *  - **It degrades to nothing rather than to something wrong.** If filtering
 *    leaves fewer than two people, or strips a weight the method needs, there
 *    is no default: equal-between-everyone is what the form does anyway, and
 *    it is the answer a reader can see is a default rather than a decision.
 *
 * A suggestion, not a constraint. The form seeds from it; the reader
 * overrides it entry by entry, and saving a new one replaces it.
 */

export interface GroupSplitDefault {
  readonly method: SplitMethod;
  /** Who the entry covers. At least two, after filtering. */
  readonly includedIds: readonly string[];
  /**
   * The per-person numbers the method needs — weights, percentages, amounts.
   *
   * Empty for `equal`, which has no numbers: an equal split between a chosen
   * few is a real default, and the thing being remembered is the *few*.
   */
  readonly values: Readonly<Record<string, string>>;
}

/** Whether a split is worth remembering at all. */
export function worthSaving(input: {
  method: SplitMethod;
  includedIds: readonly string[];
  memberCount: number;
}): boolean {
  // Equal between everyone is what a new entry already does. Offering to
  // remember it would be offering to remember the default.
  if (
    input.method === "equal" &&
    input.includedIds.length === input.memberCount
  ) {
    return false;
  }
  return input.includedIds.length >= 1;
}

/**
 * The stored blob as a default this group can actually use, or null.
 *
 * `stored` is whatever the column holds — it crossed a JSON boundary and may
 * predate any shape this file has had, so every field is checked rather than
 * cast.
 */
export function groupSplitDefault(
  stored: unknown,
  memberIds: readonly string[],
): GroupSplitDefault | null {
  if (typeof stored !== "object" || stored === null) return null;
  const raw = stored as {
    method?: unknown;
    includedIds?: unknown;
    values?: unknown;
  };

  if (
    typeof raw.method !== "string" ||
    !(SPLIT_METHODS as readonly string[]).includes(raw.method)
  ) {
    return null;
  }
  const method = raw.method as SplitMethod;

  if (!Array.isArray(raw.includedIds)) return null;
  const live = new Set(memberIds);
  const includedIds = raw.includedIds.filter(
    (id): id is string => typeof id === "string" && live.has(id),
  );

  /*
   * One person left is not a split anybody meant to save; it is what remains
   * of one after the others were removed. Falling back to equal-everyone says
   * less than a wrong answer would.
   */
  if (includedIds.length < 2) return null;

  const values: Record<string, string> = {};
  if (typeof raw.values === "object" && raw.values !== null) {
    for (const [id, value] of Object.entries(
      raw.values as Record<string, unknown>,
    )) {
      if (live.has(id) && typeof value === "string") values[id] = value;
    }
  }

  /*
   * Every method but `equal` *is* its numbers, so a weighted split that lost
   * anybody is not the split that was saved: 30/30/40 missing a 30 is not a
   * 30/40, and there is no honest way to hand somebody else the departed
   * share. Losing a member from an equal split is survivable — the remainder
   * still splits equally — which is why only this branch refuses.
   */
  if (method !== "equal") {
    if (includedIds.length !== raw.includedIds.length) return null;
    const complete = includedIds.every(
      (id) => values[id] !== undefined && values[id] !== "",
    );
    if (!complete) return null;
  }

  return { method, includedIds, values };
}
