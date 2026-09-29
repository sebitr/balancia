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

## Recurring expenses are held to the same rules

A recurring template is checked when it is saved exactly as the entries it
will generate are checked: everybody on it belongs to the group, the payers
add up to the amount, the split resolves, and a foreign currency in a
converting group carries a rate. A template that could never produce a valid
entry is refused then, with the same error a one-off expense would get.

Generation treats each template as its own unit. One that still fails—say, a
template saved before these checks existed—is logged by its id and its
group's, counted in the worker's report and retried on the next run, while
every other template carries on. An occurrence whose payer or participant has
since left the group is skipped rather than written unbalanced.

Occurrences that fell due while a template was paused, or while its group was
archived, are skipped rather than back-filled. On resume the series picks up
at its first occurrence still to come, at the usual 09:00 in the group's
timezone; a series that ends after a number of times still gets all of them.
Occurrences missed because the worker itself was down are different—nobody
chose that gap—and they are caught up.

## Exchange rates are historical facts

Converted groups store a decimal exchange rate with each foreign-currency
expense. Multiplication uses decimal arithmetic and rounds once using the
documented rule. A later rate update never rewrites a historical expense.

Daily rate suggestions are optional and off by default. The server—not the
browser—records whether a saved rate matches a rate the instance fetched, so
the provenance is verified rather than trusted from client input.

A recurring expense is converted at the rate of each occurrence's own date,
not the rate typed when the template was set up. When a rate provider is
configured, the worker looks that day's rate up through the same cache the
form's suggestion uses, and records it as fetched (`api`) with the time the
instance fetched it. With no provider, or no quote for that day, or a provider
that fails, the occurrence keeps the template's typed rate, recorded as typed
(`manual`) and dated to when the template was created. A missing quote never
costs an occurrence: a template in a foreign currency cannot be saved without
a rate to fall back on.

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
