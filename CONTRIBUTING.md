# Contributing to Balancia

Thanks for considering it. Balancia is a small, self-hosted application that
people trust with their financial history, which shapes what "a good change"
looks like here: correct, boring, and easy for the next person to verify.

## Before you start

- **Bugs and small fixes**: open a pull request directly.
- **A new feature or anything that changes the data model**: open an issue
  first. It is much less painful to agree on an approach before the code exists.
- **Security issues**: do not open an issue. See [SECURITY.md](SECURITY.md).

## Getting set up

See [docs/development.md](docs/development.md). In short:

```bash
pnpm install
cp .env.example .env.local     # set DATABASE_URL and AUTH_SECRET
pnpm db:migrate
pnpm db:seed
pnpm dev
```

## What must pass

Exactly what CI runs:

```bash
pnpm lint
pnpm typecheck
pnpm test                  # unit and component
pnpm test:integration      # needs PostgreSQL
pnpm build
```

Playwright journeys (`pnpm test:e2e`) run in CI too; run them locally if you
touched a user-facing flow.

## House rules

### Money

This is the part with no room for interpretation.

- **Never use `number` for a monetary value.** Amounts are integer minor units,
  `bigint` in TypeScript and `bigint` in PostgreSQL, end to end.
- Amounts cross JSON as **strings**. JSON numbers cannot hold large integers
  safely.
- Exchange rates are PostgreSQL `numeric` and multiplied with decimal.js.
  Rounding happens once, deterministically, half-even.
- New allocation logic goes through `allocateByWeights`. Do not write a second
  rounding algorithm.
- Currencies with 0, 2 and 3 decimals must all work. If your change touches
  money, test JPY and KWD, not just EUR.

Anything touching allocation, balances or conversion needs **property-based
tests** (fast-check), not just examples. The invariants — allocations sum to the
total, balances sum to zero, conversion is deterministic — are the product.

### Architecture

- **Domain modules do not import React or Next.js.** Services must be callable
  from the worker, which has no request context. ESLint enforces this; the
  adapter files that exist to bridge the two are exempt by name.
- **No business logic in components.** Components handle interaction; the
  calculation lives in a pure module and is unit-tested. `expense-form-logic.ts`
  is the pattern to follow.
- **Services own transactions.** A financial write and its activity event
  commit together, or neither does.
- **Authorize before fetching**, and scope queries by the verified group ID.
  Never load by bare ID and check membership afterwards.

### Database changes

1. Edit `src/lib/db/schema/`.
2. `pnpm db:generate`.
3. **Read the generated SQL** before committing it.
4. Commit the schema change and the migration together.

Never modify a migration that has already been applied. The runner checksums
them and will refuse to start rather than diverge silently.

### Style

Prettier and ESLint decide formatting; do not argue with them in review.

Comments should explain **why**, not what. A comment restating the code is
noise; a comment explaining a non-obvious constraint is the reason the next
person does not break it.

Write user-facing strings in plain language. "That email and password
combination did not work" beats "Authentication failed (401)".

### Accessibility

Not optional:

- Balance direction is never signalled by colour alone — there is always a word
  and an icon too.
- Every interactive element is reachable and operable by keyboard.
- Form inputs have real labels; errors are associated with `aria-describedby`.
- Dialogs trap focus and close on Escape (the shadcn/ui primitives handle this
  — do not reimplement them).
- Contrast meets WCAG 2.2 AA.

## Pull requests

Keep them focused; one concern per PR. In the description, say what changed,
why, and how you verified it.

A PR that touches money or authorization should say explicitly what you tested
and what you deliberately did not.

Commits: present tense, explain the why. `Fix rounding when a share is zero`
tells a reader more than `fix bug`.

## Licence

Balancia is AGPL-3.0-or-later. By contributing, you agree your contribution is
licensed under the same terms. There is no CLA.

If you add a dependency, check its licence is compatible and note it in the PR.
**Dependencies with a paid tier, usage threshold or commercial gate are not
acceptable** — a self-hosted application must not depend on someone else's
pricing page. The audit table in the README should stay accurate.

## Code of conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
