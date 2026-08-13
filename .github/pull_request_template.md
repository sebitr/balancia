## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem, or a link to the issue. -->

## How it was verified

<!-- What you actually ran and what you saw. Not "should work". -->

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:integration`
- [ ] `pnpm build`
- [ ] `pnpm test:e2e` (if a user-facing flow changed)

## If this touches money

<!-- Delete this section if it does not. -->

- [ ] No JavaScript `number` is used for a monetary value
- [ ] Allocations still sum exactly to the total
- [ ] Balances still sum to zero
- [ ] Tested with a 0-decimal currency (JPY) and a 3-decimal currency (KWD)
- [ ] Property-based tests cover the new behaviour

## If this touches authorization or authentication

<!-- Delete this section if it does not. -->

- [ ] Authorization happens before the record is fetched
- [ ] Queries are scoped by the verified group ID
- [ ] Guest permissions are unchanged, or the change is deliberate and tested
- [ ] No secret or token is logged, returned, or stored unhashed

## If this changes the database

- [ ] A migration was generated with `pnpm db:generate`
- [ ] I read the generated SQL
- [ ] No already-applied migration was edited
