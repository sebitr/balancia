import Decimal from "decimal.js";
import { formatMoney, money } from "@/modules/currencies/money";
import {
  parseAmountToMinor,
  previewSplit,
  readSplitValue,
  type SplitPreviewAllocation,
} from "@/components/expenses/expense-form-logic";
import type { SplitMethod } from "@/modules/expenses/split";

/**
 * What the split comes to, in words, when there is something worth saying.
 *
 * `previewSplit` answers whether a split is *valid*: it hands back allocations
 * or it refuses. That is the right contract for the server, which only has to
 * accept or reject — but it throws away the one fact somebody correcting a
 * split needs, which is which way they are out and by how much. "The exact
 * amounts must add up to the total" does not tell you to type more.
 *
 * So this runs the same preview and puts its verdict into words: still to
 * assign or over the total, the percentage it actually came to, a set of
 * shares that gives nobody anything. It never decides validity on its own — a
 * note only ever explains what the preview concluded, which is what keeps the
 * sheet from calling a split fine that a save would then refuse.
 *
 * The same note travels to the summary row on the form (`summariseSplit`)
 * and to the alert a refused save raises, so the sentence is the same in all
 * three places.
 *
 * Nothing here returns display text. Notes come back as a key in the
 * `addEntry.split.notes` catalogue plus params, so the module stays
 * locale-agnostic and the tests assert on keys rather than on English prose.
 * The one exception is the list of names, which is joined here with the
 * reader's own conjunction because a sentence cannot take an array.
 */

export type SplitNoteKey =
  | "nobody"
  | "roundedUp"
  | "stillToAssign"
  | "overTheTotal"
  | "percentagesOff"
  | "sharesAllZero"
  | "unreadable";

export interface SplitNote {
  readonly key: SplitNoteKey;
  readonly params?: Readonly<Record<string, string | number>>;
  /**
   * `error` marks a split that cannot be saved as it stands; `info` explains
   * something that is already true of a perfectly valid split. Only the colour
   * and the warning on the summary row read this — the wording carries the
   * meaning.
   */
  readonly tone: "info" | "error";
}

export function describeSplit(input: {
  totalMinor: bigint | null;
  currency: string;
  method: SplitMethod;
  participantIds: readonly string[];
  values: Readonly<Record<string, string>>;
  /** Somebody's name as the sheet shows it. */
  nameOf: (participantId: string) => string;
  /** The reader, who is "you" rather than a name. */
  selfId?: string;
  /** Formats the amounts; defaults to the runtime's locale. */
  locale?: string;
  /**
   * The language the sentence is in, for "Anna and Jonas".
   *
   * Separate from `locale`, which is how the reader writes numbers: somebody
   * reading French with Swiss figures still wants "et", not "and".
   */
  language?: string;
}): SplitNote | null {
  const {
    totalMinor,
    currency,
    method,
    participantIds,
    values,
    nameOf,
    selfId,
    locale,
    language,
  } = input;

  // Said whatever the amount is: an empty selection is a state somebody chose,
  // not a transient one to keep quiet about until they have typed a figure.
  if (participantIds.length === 0) {
    return { key: "nobody", tone: "error" };
  }
  if (totalMinor === null) return null;

  const format = (minor: bigint) =>
    formatMoney(money(minor, currency), { locale });

  const preview = previewSplit({
    totalMinor,
    currency,
    method,
    participantIds,
    values,
    locale,
  });

  if (!preview.ok) {
    switch (preview.error?.key) {
      case "participantsRequired":
        return { key: "nobody", tone: "error" };

      case "exactSumMismatch": {
        // Every value parsed, or the preview would have refused it by name.
        const assigned = participantIds.reduce((sum, id) => {
          const text = readSplitValue(values[id]);
          const parsed = parseAmountToMinor(text === "" ? "0" : text, currency);
          return parsed.ok ? sum + parsed.value : sum;
        }, 0n);
        const difference = totalMinor - assigned;
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

      case "percentageSumMismatch": {
        const sum = participantIds.reduce((total, id) => {
          const text = readSplitValue(values[id]);
          return total.plus(new Decimal(text === "" ? "0" : text));
        }, new Decimal(0));
        return {
          key: "percentagesOff",
          // `toString` rather than a fixed precision: 99.5 should read as
          // 99.5 and not as 99.50, and 100.001 has to stay visibly wrong.
          params: { sum: sum.toString() },
          tone: "error",
        };
      }

      case "sharesAllZero":
        return { key: "sharesAllZero", tone: "error" };

      // A letter, a minus sign, a fourth decimal: something in a field the
      // split cannot read as a number. Rare from a phone's decimal keyboard,
      // but a save would refuse it, so the row has to say so too.
      default:
        return { key: "unreadable", tone: "error" };
    }
  }

  return method === "exact"
    ? null
    : roundedUp({
        allocations: preview.allocations,
        weightOf: (id) =>
          method === "equal"
            ? "1"
            : new Decimal(readSplitValue(values[id]) || "0").toString(),
        participantIds,
        nameOf,
        selfId,
        language,
        amount: format,
        total: format(totalMinor),
      });
}

/**
 * Who pays a minor unit more than somebody who asked for the same thing.
 *
 * Largest remainder never misplaces money, but it does make two people who
 * were given the same weight pay amounts a cent apart, and that is the only
 * rounding anybody can see: €100 three ways is €33.34 beside two €33.33s, and
 * the reader wants to know why one of them is different. Everywhere else the
 * moved units are invisible — €90 at 33.34 / 33.33 / 33.33 per cent is three
 * people paying €30.00 each — and a note saying "two people pay €0.02 more" of
 * three identical figures is the arithmetic talking to itself.
 *
 * So the rule is about the figures on screen: among people whose entered
 * values are equal, anyone whose amount is above the lowest of them is named.
 * Within such a group the gap is always exactly one minor unit, because every
 * part in it floors to the same figure and the pass hands out at most one unit
 * each.
 */
function roundedUp(input: {
  allocations: readonly SplitPreviewAllocation[];
  weightOf: (participantId: string) => string;
  participantIds: readonly string[];
  nameOf: (participantId: string) => string;
  selfId?: string;
  language?: string;
  amount: (minor: bigint) => string;
  total: string;
}): SplitNote | null {
  const { allocations, weightOf, participantIds, nameOf, selfId, language } =
    input;

  const amountOf = new Map(
    allocations.map((allocation) => [
      allocation.participantId,
      allocation.amount,
    ]),
  );

  const lowest = new Map<string, bigint>();
  const members = new Map<string, number>();
  for (const id of participantIds) {
    const weight = weightOf(id);
    const amount = amountOf.get(id) ?? 0n;
    const floor = lowest.get(weight);
    lowest.set(weight, floor === undefined || amount < floor ? amount : floor);
    members.set(weight, (members.get(weight) ?? 0) + 1);
  }

  let extra = 0n;
  // Participant order, which is member order: the order the units went out in.
  const ahead = participantIds.filter((id) => {
    const weight = weightOf(id);
    if ((members.get(weight) ?? 0) < 2) return false;
    const over = (amountOf.get(id) ?? 0n) - (lowest.get(weight) ?? 0n);
    if (over > extra) extra = over;
    return over > 0n;
  });
  if (ahead.length === 0) return null;

  const you = selfId !== undefined && ahead.includes(selfId);
  const others = ahead.filter((id) => id !== selfId).map(nameOf);

  return {
    key: "roundedUp",
    params: {
      you: you ? "yes" : "no",
      count: others.length,
      names: new Intl.ListFormat(language, { type: "conjunction" }).format(
        others,
      ),
      amount: input.amount(extra),
      total: input.total,
    },
    tone: "info",
  };
}
