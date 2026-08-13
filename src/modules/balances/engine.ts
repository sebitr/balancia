/**
 * Balance engine.
 *
 * Pure functions: given the financial facts of a group, produce each
 * participant's net position and a suggested set of repayments. No database,
 * no dates, no I/O — everything here is testable in isolation and produces
 * identical output for identical input.
 *
 * Sign convention throughout Balancia:
 *   balance > 0  → the participant is owed money (they paid more than their share)
 *   balance < 0  → the participant owes money
 *   balance = 0  → settled
 *
 * The engine never mutates history: simplification is a *suggestion* computed
 * from balances, not a rewrite of the expenses that produced them.
 */

export interface BalanceInputPayer {
  readonly participantId: string;
  /** Minor units this participant put in, in the balance currency. */
  readonly amount: bigint;
}

export interface BalanceInputShare {
  readonly participantId: string;
  /** Minor units this participant is responsible for, in the balance currency. */
  readonly amount: bigint;
}

export interface BalanceInputExpense {
  readonly id: string;
  readonly currency: string;
  readonly payers: readonly BalanceInputPayer[];
  readonly shares: readonly BalanceInputShare[];
}

export interface BalanceInputSettlement {
  readonly id: string;
  readonly currency: string;
  /** Participant handing money over. */
  readonly fromParticipantId: string;
  /** Participant receiving it. */
  readonly toParticipantId: string;
  readonly amount: bigint;
}

export interface ParticipantBalance {
  readonly participantId: string;
  /** Net position in minor units; positive means owed money. */
  readonly amount: bigint;
  readonly currency: string;
}

export interface CurrencyBalances {
  readonly currency: string;
  readonly balances: readonly ParticipantBalance[];
  /** Sum of all positive balances — the total in motion for this currency. */
  readonly totalOutstanding: bigint;
}

export interface BalanceComputationInput {
  /**
   * Every participant that should appear in the result, in a stable order.
   * Participants with no activity are reported with a zero balance so the UI
   * can show "settled up" instead of omitting them.
   */
  readonly participantIds: readonly string[];
  /** Expenses, already excluding soft-deleted rows and already converted if the group converts. */
  readonly expenses: readonly BalanceInputExpense[];
  readonly settlements: readonly BalanceInputSettlement[];
}

export class BalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BalanceError";
  }
}

/**
 * Computes balances grouped by currency.
 *
 * In `separate` mode a group can hold several currencies at once and each is
 * balanced independently. In `converted` mode the caller has already converted
 * everything to the base currency, so exactly one entry comes back. Both paths
 * run through this same function — there is no second implementation to drift.
 */
export function computeBalances(
  input: BalanceComputationInput,
): CurrencyBalances[] {
  const participantOrder = new Map<string, number>();
  input.participantIds.forEach((participantId, index) => {
    participantOrder.set(participantId, index);
  });

  const assertKnown = (participantId: string, context: string): void => {
    if (!participantOrder.has(participantId)) {
      throw new BalanceError(
        `${context} references participant ${participantId}, which is not part of the group`,
      );
    }
  };

  // currency → participantId → minor units
  const ledger = new Map<string, Map<string, bigint>>();

  const bump = (
    currency: string,
    participantId: string,
    delta: bigint,
  ): void => {
    let byParticipant = ledger.get(currency);
    if (!byParticipant) {
      byParticipant = new Map<string, bigint>();
      ledger.set(currency, byParticipant);
    }
    byParticipant.set(
      participantId,
      (byParticipant.get(participantId) ?? 0n) + delta,
    );
  };

  for (const expense of input.expenses) {
    const paid = expense.payers.reduce(
      (accumulator, payer) => accumulator + payer.amount,
      0n,
    );
    const owed = expense.shares.reduce(
      (accumulator, share) => accumulator + share.amount,
      0n,
    );
    if (paid !== owed) {
      throw new BalanceError(
        `Expense ${expense.id} is unbalanced: payers contributed ${paid} but shares total ${owed}`,
      );
    }
    for (const payer of expense.payers) {
      assertKnown(payer.participantId, `Expense ${expense.id}`);
      bump(expense.currency, payer.participantId, payer.amount);
    }
    for (const share of expense.shares) {
      assertKnown(share.participantId, `Expense ${expense.id}`);
      bump(expense.currency, share.participantId, -share.amount);
    }
  }

  for (const settlement of input.settlements) {
    assertKnown(settlement.fromParticipantId, `Settlement ${settlement.id}`);
    assertKnown(settlement.toParticipantId, `Settlement ${settlement.id}`);
    if (settlement.amount < 0n) {
      throw new BalanceError(
        `Settlement ${settlement.id} has a negative amount; reverse the direction instead`,
      );
    }
    if (settlement.fromParticipantId === settlement.toParticipantId) {
      throw new BalanceError(
        `Settlement ${settlement.id} pays a participant to themselves`,
      );
    }
    // Paying someone reduces what you owe (moves your balance up) and reduces
    // what they are owed (moves theirs down).
    bump(settlement.currency, settlement.fromParticipantId, settlement.amount);
    bump(settlement.currency, settlement.toParticipantId, -settlement.amount);
  }

  const currencies = [...ledger.keys()].sort();
  return currencies.map((currency) => {
    const byParticipant = ledger.get(currency) ?? new Map<string, bigint>();
    const balances = input.participantIds.map((participantId) => ({
      participantId,
      amount: byParticipant.get(participantId) ?? 0n,
      currency,
    }));
    const totalOutstanding = balances.reduce(
      (accumulator, balance) =>
        balance.amount > 0n ? accumulator + balance.amount : accumulator,
      0n,
    );
    return { currency, balances, totalOutstanding };
  });
}

export interface RepaymentSuggestion {
  readonly fromParticipantId: string;
  readonly toParticipantId: string;
  readonly amount: bigint;
  readonly currency: string;
}

/**
 * Suggests a minimal-ish set of repayments that clears the balances.
 *
 * Greedy largest-debtor → largest-creditor. This is not guaranteed optimal
 * (minimizing transfers exactly is NP-hard), but it produces at most n-1
 * transfers, is easy to explain to a person looking at the screen, and is
 * fully deterministic: ties are broken by the participant order given in
 * `balances`, which callers derive from a stable database ordering.
 */
export function simplifyDebts(
  balances: readonly ParticipantBalance[],
): RepaymentSuggestion[] {
  if (balances.length === 0) {
    return [];
  }
  const currency = balances[0].currency;
  for (const balance of balances) {
    if (balance.currency !== currency) {
      throw new BalanceError(
        "simplifyDebts expects balances in a single currency",
      );
    }
  }

  const order = new Map<string, number>();
  balances.forEach((balance, index) => order.set(balance.participantId, index));

  const debtors = balances
    .filter((balance) => balance.amount < 0n)
    .map((balance) => ({
      participantId: balance.participantId,
      remaining: -balance.amount,
    }));
  const creditors = balances
    .filter((balance) => balance.amount > 0n)
    .map((balance) => ({
      participantId: balance.participantId,
      remaining: balance.amount,
    }));

  const byAmountThenOrder = (
    a: { participantId: string; remaining: bigint },
    b: { participantId: string; remaining: bigint },
  ): number => {
    if (a.remaining !== b.remaining) {
      return a.remaining > b.remaining ? -1 : 1;
    }
    return (
      (order.get(a.participantId) ?? 0) - (order.get(b.participantId) ?? 0)
    );
  };

  debtors.sort(byAmountThenOrder);
  creditors.sort(byAmountThenOrder);

  const suggestions: RepaymentSuggestion[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount =
      debtor.remaining < creditor.remaining
        ? debtor.remaining
        : creditor.remaining;

    if (amount > 0n) {
      suggestions.push({
        fromParticipantId: debtor.participantId,
        toParticipantId: creditor.participantId,
        amount,
        currency,
      });
      debtor.remaining -= amount;
      creditor.remaining -= amount;
    }

    if (debtor.remaining === 0n) debtorIndex += 1;
    if (creditor.remaining === 0n) creditorIndex += 1;
  }

  return suggestions;
}

/**
 * The invariant every balance set must satisfy: money is conserved, so all
 * balances in a currency sum to zero. Callers assert this after computing
 * balances; the property tests hammer it with random inputs.
 */
export function balancesSumToZero(
  balances: readonly ParticipantBalance[],
): boolean {
  return (
    balances.reduce(
      (accumulator, balance) => accumulator + balance.amount,
      0n,
    ) === 0n
  );
}

/** Convenience: total spend per currency, derived from expense payer contributions. */
export function totalSpendByCurrency(
  expenses: readonly BalanceInputExpense[],
): Map<string, bigint> {
  const totals = new Map<string, bigint>();
  for (const expense of expenses) {
    const paid = expense.payers.reduce(
      (accumulator, payer) => accumulator + payer.amount,
      0n,
    );
    totals.set(expense.currency, (totals.get(expense.currency) ?? 0n) + paid);
  }
  return totals;
}
