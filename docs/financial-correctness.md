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
