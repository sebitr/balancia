import { parseAmountToMinor } from "@/components/expenses/expense-form-logic";

/**
 * More than one person putting money in.
 *
 * The 95% entry has one payer, which is why the sheet leads with a row of
 * faces and hides this behind the last pill in it. But the 5% is real — two
 * people splitting a deposit at the counter, one card declining and another
 * covering the rest — and the ledger has always been able to hold it: the
 * schema takes an array of payers, the service writes a row each, and the
 * balance engine refuses an expense whose contributions do not equal its
 * shares.
 *
 * That last refusal is what this module exists to keep the reader in front
 * of. An unbalanced expense is not a warning the server can soften; it is
 * rejected. So the shortfall is named while it can still be fixed, and the
 * three shortcuts are the three ways people actually fix it.
 *
 * Amounts are text here because they come from inputs, and integer cents once
 * parsed. Anything unparseable counts as nothing rather than as an error —
 * somebody halfway through typing "1" in "12.50" has not made a mistake yet.
 */

export interface MultiPayerState {
  /** Per participant, as typed. A missing or empty entry is zero. */
  readonly amounts: Readonly<Record<string, string>>;
}

export interface MultiPayerSummary {
  /** What the named payers add up to, in minor units. */
  readonly paidMinor: bigint;
  /**
   * Total minus paid. Positive is still to assign, negative is over.
   *
   * Zero is the only state that saves, which is why it is a signed number
   * rather than a boolean: the two sides need different words.
   */
  readonly differenceMinor: bigint;
  /** Who has an amount against them, in the order given. */
  readonly payerIds: readonly string[];
}

export function summariseMultiPayer(input: {
  amounts: Readonly<Record<string, string>>;
  memberIds: readonly string[];
  currency: string;
  totalMinor: bigint;
}): MultiPayerSummary {
  const { amounts, memberIds, currency, totalMinor } = input;

  let paidMinor = 0n;
  const payerIds: string[] = [];

  // Iterated in member order rather than object order, so "the rest" always
  // goes to the same person for the same screen.
  for (const id of memberIds) {
    const parsed = parseAmountToMinor(amounts[id] ?? "", currency);
    if (!parsed.ok || parsed.value <= 0n) continue;
    paidMinor += parsed.value;
    payerIds.push(id);
  }

  return {
    paidMinor,
    differenceMinor: totalMinor - paidMinor,
    payerIds,
  };
}

/**
 * The payers as the server wants them, or null when they do not add up.
 *
 * Null rather than a best effort: an expense whose contributions miss its
 * total is one the balance engine throws on, and sending it would turn a
 * fixable warning into a failed save.
 */
export function multiPayerContributions(input: {
  amounts: Readonly<Record<string, string>>;
  memberIds: readonly string[];
  currency: string;
  totalMinor: bigint;
}): readonly { participantId: string; amount: string }[] | null {
  const summary = summariseMultiPayer(input);
  if (summary.differenceMinor !== 0n) return null;
  if (summary.payerIds.length === 0) return null;

  return summary.payerIds.map((id) => {
    // Every id in `payerIds` parsed to something positive on the way in, so
    // this cannot fail — but "cannot fail" is not a reason to write a `!`.
    const parsed = parseAmountToMinor(input.amounts[id] ?? "", input.currency);
    return {
      participantId: id,
      amount: parsed.ok ? parsed.value.toString() : "0",
    };
  });
}

/**
 * Everyone in the split pays an equal part of it.
 *
 * The remainder goes to the first person in member order, which is the same
 * rule the split itself uses — one place where the odd cent lands, whichever
 * side of the entry is being divided.
 */
export function splitPaymentEqually(input: {
  payerIds: readonly string[];
  currency: string;
  totalMinor: bigint;
  format: (minor: bigint, currency: string) => string;
}): Record<string, string> {
  const { payerIds, currency, totalMinor, format } = input;
  if (payerIds.length === 0 || totalMinor <= 0n) return {};

  const each = totalMinor / BigInt(payerIds.length);
  const remainder = totalMinor - each * BigInt(payerIds.length);

  const amounts: Record<string, string> = {};
  payerIds.forEach((id, index) => {
    const share = index === 0 ? each + remainder : each;
    amounts[id] = format(share, currency);
  });
  return amounts;
}

/**
 * Hands whatever is missing to one person.
 *
 * The commonest fix by a distance: two people paid, one of them typed their
 * half, and the other one's is "the rest". Also handles an overage, by
 * reducing them — which is the same gesture and the same sentence.
 */
export function giveRestTo(input: {
  amounts: Readonly<Record<string, string>>;
  participantId: string;
  memberIds: readonly string[];
  currency: string;
  totalMinor: bigint;
  format: (minor: bigint, currency: string) => string;
}): Record<string, string> {
  const { amounts, participantId, memberIds, currency, totalMinor, format } =
    input;

  let others = 0n;
  for (const id of memberIds) {
    if (id === participantId) continue;
    const parsed = parseAmountToMinor(amounts[id] ?? "", currency);
    if (parsed.ok && parsed.value > 0n) others += parsed.value;
  }

  const rest = totalMinor - others;
  const next = { ...amounts };
  // A negative rest means the others have already overpaid, and there is no
  // amount this person can hold that fixes it. Zero says so plainly and the
  // warning line keeps naming the overage.
  next[participantId] = format(rest > 0n ? rest : 0n, currency);
  return next;
}
