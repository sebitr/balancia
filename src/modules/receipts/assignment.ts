import Decimal from "decimal.js";
import { allocateByWeights } from "@/modules/expenses/allocation";
import {
  resolveSplit,
  type SplitInput,
  type SplitResult,
} from "@/modules/expenses/split";
import type { ReceiptItem } from "./types";

/**
 * Turning "who had what" into a Balancia split.
 *
 * This is the part of receipt scanning that touches money, so it does as
 * little arithmetic of its own as possible. Items and shared charges are
 * reduced to a per-participant amount using `allocateByWeights` — the same
 * largest-remainder allocator every other split in Balancia goes through — and
 * the result is then handed to `resolveSplit` as an ordinary **exact** split.
 *
 * That matters for a reason beyond tidiness: the expense that gets created is
 * an ordinary expense. It has no memory of having come from a photograph, the
 * balance engine reads the same allocations it reads for a split typed by
 * hand, and `resolveSplit` re-validates that the parts sum to the total before
 * anything is stored. Receipt items are an input aid; they are not a second
 * accounting system, and nothing here is authoritative over the split engine.
 *
 * The total is the authority
 * -------------------------
 * Shared charges are computed as a **residual** — `total − Σ assigned items` —
 * rather than as `tax + tip + service`. Three reasons, all of them about the
 * sum being exactly right:
 *
 *   - the parts are OCR output and may not add up, while the total is the
 *     number the user confirmed on the review screen;
 *   - a charge the parser never saw (a cover charge, a rounding line, a
 *     discount) is still distributed rather than silently dropped;
 *   - the invariant `Σ shares === total` then holds by construction, for every
 *     input, including the ones where the receipt contradicts itself.
 */

/** How a charge that belongs to nobody in particular is spread. */
export type SharedChargeStrategy = "proportional" | "equal";

export interface ItemAssignment {
  readonly itemId: string;
  /** Everyone who shared this item. Empty means nobody claimed it yet. */
  readonly participantIds: readonly string[];
}

export interface AssignmentInput {
  readonly items: readonly ReceiptItem[];
  readonly assignments: readonly ItemAssignment[];
  /** Everyone the expense may be split between, in a stable order. */
  readonly participantIds: readonly string[];
  /** The confirmed expense total, in minor units. */
  readonly total: bigint;
  readonly strategy: SharedChargeStrategy;
}

export interface ParticipantShare {
  readonly participantId: string;
  /** What this person owes in total, in minor units. */
  readonly amount: bigint;
  /** The part of `amount` that came from items they were assigned. */
  readonly items: bigint;
  /** The part of `amount` that came from shared charges. */
  readonly shared: bigint;
}

export interface AssignmentResult {
  readonly shares: readonly ParticipantShare[];
  /** `total − Σ assigned items`: tax, tip, service and anything unaccounted. */
  readonly sharedCharges: bigint;
  /** Items nobody has claimed. Their cost falls into `sharedCharges`. */
  readonly unassignedItemIds: readonly string[];
}

export class ReceiptAssignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptAssignmentError";
  }
}

const ONE = new Decimal(1);

/**
 * Distributes items and shared charges across participants.
 *
 * Guarantees, all asserted by the tests:
 *   1. `Σ shares.amount === total`, exactly, for every input.
 *   2. The same input in the same order always produces the same output.
 *   3. An item shared by several people is split equally between them, with
 *      the odd minor unit going to the earliest participant in the group's
 *      ordering rather than to whoever happens to be first in a Set.
 */
export function assignReceipt(input: AssignmentInput): AssignmentResult {
  const { items, assignments, participantIds, total, strategy } = input;

  if (participantIds.length === 0) {
    throw new ReceiptAssignmentError(
      "A receipt split needs at least one participant",
    );
  }
  const known = new Set(participantIds);
  const order = new Map(participantIds.map((id, index) => [id, index]));

  const itemTotals = new Map(participantIds.map((id) => [id, 0n]));
  const byItem = new Map(
    assignments.map((entry) => [entry.itemId, entry.participantIds]),
  );

  const unassignedItemIds: string[] = [];
  let assignedTotal = 0n;

  for (const item of items) {
    const raw = byItem.get(item.id) ?? [];
    // Deduplicate, drop anyone not in the split, and restore the group's
    // ordering so the rounding unit lands deterministically.
    const claimants = [...new Set(raw)]
      .filter((id) => known.has(id))
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

    if (claimants.length === 0) {
      unassignedItemIds.push(item.id);
      continue;
    }

    const parts = allocateByWeights(
      item.total,
      claimants.map(() => ONE),
    );
    for (const [index, id] of claimants.entries()) {
      itemTotals.set(id, (itemTotals.get(id) ?? 0n) + parts[index]);
    }
    assignedTotal += item.total;
  }

  const sharedCharges = total - assignedTotal;

  /* --------------------------------------------------------------- shared */

  let sharedParts: bigint[];
  if (sharedCharges === 0n) {
    sharedParts = participantIds.map(() => 0n);
  } else {
    const proportional =
      strategy === "proportional" &&
      participantIds.some((id) => (itemTotals.get(id) ?? 0n) > 0n);

    const weights = proportional
      ? participantIds.map(
          // Weights must not be negative; a credit item cannot pull someone's
          // share of the tax below zero.
          (id) => {
            const value = itemTotals.get(id) ?? 0n;
            return new Decimal((value > 0n ? value : 0n).toString());
          },
        )
      : // Proportional with nothing assigned yet has no proportions to use, so
        // it falls back to equal — which is what the user would otherwise have
        // had to pick to get any answer at all.
        participantIds.map(() => ONE);

    sharedParts = allocateByWeights(sharedCharges, weights);
  }

  const shares = participantIds.map((id, index) => {
    const itemsAmount = itemTotals.get(id) ?? 0n;
    const sharedAmount = sharedParts[index];
    return {
      participantId: id,
      amount: itemsAmount + sharedAmount,
      items: itemsAmount,
      shared: sharedAmount,
    } satisfies ParticipantShare;
  });

  return { shares, sharedCharges, unassignedItemIds };
}

/**
 * The exact-split input for a set of shares.
 *
 * Participants who end up owing nothing are left out: an expense that lists
 * someone for zero reads as though they took part, and the balance engine
 * would carry a row that means nothing. If *everyone* is at zero — a receipt
 * totalling zero — the participants are kept, because a split needs at least
 * one entry.
 */
export function toSplitInput(shares: readonly ParticipantShare[]): SplitInput {
  const nonZero = shares.filter((share) => share.amount !== 0n);
  const entries = (nonZero.length > 0 ? nonZero : shares).map((share) => ({
    participantId: share.participantId,
    value: share.amount.toString(),
  }));
  return { method: "exact", entries };
}

/**
 * Assignment straight through to a canonical split result.
 *
 * The last step is `resolveSplit`, which re-checks that the parts sum to the
 * total. If a future change to this module ever broke that invariant, the
 * expense would be rejected by the same validation that rejects a hand-typed
 * exact split that does not add up — rather than being quietly stored wrong.
 */
export function buildReceiptSplit(input: AssignmentInput): {
  readonly assignment: AssignmentResult;
  readonly split: SplitResult;
} {
  const assignment = assignReceipt(input);
  const split = resolveSplit(input.total, toSplitInput(assignment.shares));
  return { assignment, split };
}
