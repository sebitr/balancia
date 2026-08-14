import Decimal from "decimal.js";
import { formatMoney, money } from "@/modules/currencies/money";
import { parseAmountToMinor } from "@/components/expenses/expense-form-logic";
import type { SplitMethod } from "@/modules/expenses/split";

/**
 * What the split does not add up to, in words.
 *
 * `previewSplit` answers whether a split is *valid*: it hands back allocations
 * or it refuses. That is the right contract for the server, which only has to
 * accept or reject — but it throws away the one fact somebody correcting a
 * split needs, which is which way they are out and by how much. "The exact
 * amounts must add up to the total" does not tell you to type more.
 *
 * So this recomputes the shortfall from the same raw inputs and names it:
 * still to assign, or over the total. It never validates anything — a note is
 * an explanation, and the decision to refuse a save stays with `previewSplit`
 * and, ultimately, with `resolveSplit` on the server.
 *
 * Nothing here returns display text. Notes come back as a key in the
 * `addEntry.split.notes` catalogue plus params, so the module stays
 * locale-agnostic and the tests assert on keys rather than on English prose.
 */

export type SplitNoteKey =
  | "nobody"
  | "remainderAbsorbed"
  | "stillToAssign"
  | "overTheTotal"
  | "percentagesOff";

export interface SplitNote {
  readonly key: SplitNoteKey;
  readonly params?: Readonly<Record<string, string | number>>;
  /**
   * `error` marks a split that cannot be saved as it stands; `info` explains
   * something that is already true of a perfectly valid split. Only the colour
   * and the disabled state read this — the wording carries the meaning.
   */
  readonly tone: "info" | "error";
}

const HUNDRED = new Decimal(100);

export function describeSplit(input: {
  totalMinor: bigint | null;
  currency: string;
  method: SplitMethod;
  participantIds: readonly string[];
  values: Readonly<Record<string, string>>;
  /**
   * The first included member's name. An equal split hands its leftover minor
   * units out in member order, so this is the person who actually absorbs
   * them — saying "somebody" would be true and useless.
   */
  absorberName: string;
  /** Formats the amounts; defaults to the runtime's locale. */
  locale?: string;
}): SplitNote | null {
  const {
    totalMinor,
    currency,
    method,
    participantIds,
    values,
    absorberName,
    locale,
  } = input;

  // Said whatever the amount is: an empty selection is a state somebody chose,
  // not a transient one to keep quiet about until they have typed a figure.
  if (participantIds.length === 0) {
    return { key: "nobody", tone: "error" };
  }
  if (totalMinor === null) return null;

  const format = (minor: bigint) =>
    formatMoney(money(minor, currency), { locale });

  switch (method) {
    case "equal": {
      const count = BigInt(participantIds.length);
      const remainder = totalMinor - (totalMinor / count) * count;
      if (remainder === 0n) return null;
      return {
        key: "remainderAbsorbed",
        params: { amount: format(remainder), name: absorberName },
        tone: "info",
      };
    }

    case "exact": {
      const assigned = participantIds.reduce((sum, id) => {
        const parsed = parseAmountToMinor(values[id] ?? "", currency);
        return parsed.ok ? sum + parsed.value : sum;
      }, 0n);
      const difference = totalMinor - assigned;
      if (difference === 0n) return null;
      return difference > 0n
        ? {
            key: "stillToAssign",
            params: { amount: format(difference) },
            tone: "error",
          }
        : {
            key: "overTheTotal",
            params: { amount: format(-difference) },
            tone: "error",
          };
    }

    case "percentage": {
      const sum = participantIds.reduce((total, id) => {
        const raw = (values[id] ?? "").trim();
        if (raw === "") return total;
        try {
          const parsed = new Decimal(raw.replace(/,/g, "."));
          return parsed.isFinite() ? total.plus(parsed) : total;
        } catch {
          // A half-typed percentage ("1.", "-") contributes nothing yet.
          return total;
        }
      }, new Decimal(0));

      if (sum.equals(HUNDRED)) return null;
      return {
        key: "percentagesOff",
        // `toString` rather than a fixed precision: 99.5 should read as 99.5
        // and not as 99.50, and 100.001 has to stay visibly wrong.
        params: { sum: sum.toString() },
        tone: "error",
      };
    }

    // Shares divide by largest remainder like any other weighting, and the
    // leftover unit it moves is already reported by `previewSplit`'s rounding
    // note. A second sentence saying the same thing differently is worse than
    // none.
    case "shares":
      return null;
  }
}
