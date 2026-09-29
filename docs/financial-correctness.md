# Financial correctness

Balancia's primary job is to say who owes whom. A result that is almost right
is wrong, so monetary correctness is enforced as code-level invariants rather
than left to display formatting.

## Amounts are integers

Every monetary amount is stored as an integer count of the currency's minor
unit:

| Currency | Stored unit | Display example    |
| -------- | ----------- | ------------------ |
| JPY      | yen         | `1050` → ¥1,050    |
| EUR      | cent        | `1050` → €10.50    |
| KWD      | fils        | `1050` → KWD 1.050 |

PostgreSQL stores these values as `bigint`, TypeScript uses `bigint`, and JSON
boundaries carry them as strings. JavaScript floating-point numbers never
represent money.

## Splits add up exactly

Equal, percentage and share-based splits can leave indivisible minor units. For
example, €10.00 divided between three people cannot produce three identical
cent amounts.

Balancia uses a deterministic largest-remainder allocation:

1. calculate each participant's exact proportional share;
2. assign the whole minor units;
3. distribute the remaining units in a stable order; and
4. verify that the allocations sum to the original total.

The interface tells the user when one or more people receive the rounding unit.
It never hides the adjustment.

## Balances sum to zero

For every currency in a group, the sum of all participant balances must equal
zero. What one person owes is exactly what another person should receive. The
balance engine checks this invariant and refuses to present a result if it is
violated.

Suggested settlement payments are deterministic. The same balances produce
the same transfer list, which makes behavior testable and avoids a result that
appears to change randomly between page loads.

## Removing somebody never strands a debt

Removing a person from a group keeps their history: every expense and
repayment that names them still counts, so their balance is still part of the
group's. What removal takes away is the ability to name them in anything new.
Those two rules together could leave a debt nobody can record, so three more
hold them in place:

- **Removal waits for zero.** Somebody who still owes or is owed anything, in
  any currency the group keeps, cannot be removed; the server refuses, not
  only the button. The check reads the balance under a row lock that every
  write naming that person also takes, so an expense landing in the same
  instant either counts or is refused — never both.
- **An old entry keeps the people it had.** Editing an expense or a repayment
  that names somebody removed since is allowed, and they may stay on it.
  Adding a removed person to an entry they were not on is refused.
- **A leftover debt can always be settled.** A balance can still move after
  removal — an old expense edited, a repayment deleted, a deletion undone — so
  a repayment may name a removed person, but only in the direction that
  settles what they have outstanding and for no more than it. It can close a
  debt; it cannot open one.

## Exchange rates are historical facts

Converted groups store a decimal exchange rate with each foreign-currency
expense. Multiplication uses decimal arithmetic and rounds once using the
documented rule. A later rate update never rewrites a historical expense.

Daily rate suggestions are optional and off by default. The server—not the
browser—records whether a saved rate matches a rate the instance fetched, so
the provenance is verified rather than trusted from client input.

## Tests focus on invariants

Example-based tests cover known scenarios, and property-based tests generate
random inputs to exercise the rules repeatedly:

- allocations always sum to the transaction total;
- balances always sum to zero;
- the result is deterministic for the same inputs;
- zero-, two- and three-decimal currencies behave correctly;
- large values remain exact across database and JSON boundaries; and
- conversions round once and preserve the stored rate.

The relevant implementation lives in `src/modules/expenses`,
`src/modules/balances` and `src/modules/currencies`. Contributors changing this
logic must add property-based coverage; see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Scope

Balancia records informal shared expenses and suggested repayments. It is not a
bank, accounting ledger, payment processor or legally binding debt service. It
does not move money. People remain responsible for the transactions they enter
and the payments they make outside Balancia.
