# Development

## Prerequisites

- **Node.js 24 LTS**
- **pnpm 11** — the version is pinned in `packageManager`; run `corepack enable`
  and it will use the right one
- **PostgreSQL 18** — locally, or in Docker

## Setup

```bash
pnpm install

# A PostgreSQL to develop against. Anything works; this is the quickest:
docker run -d --name balancia-dev-db \
  -e POSTGRES_USER=balancia \
  -e POSTGRES_PASSWORD=balancia \
  -e POSTGRES_DB=balancia \
  -p 5432:5432 postgres:18-alpine

cp .env.example .env.local
# set at minimum:
#   DATABASE_URL=postgres://balancia:balancia@localhost:5432/balancia
#   AUTH_SECRET=dev-only-secret-0123456789abcdef0123456789abcdef

pnpm db:migrate
pnpm db:seed        # optional; prints a sign-in and a guest link
pnpm dev
```

The seed creates one user (`ada@example.com` / `balancia-dev-password`), a
converted-currency group and a separate-currency group, expenses using all four
split methods, a multi-payer expense, a settlement, a recurring template, and
the activity history that goes with them.

Run the background worker in a second terminal when you need recurring expenses
or import jobs:

```bash
pnpm dev:worker
```

## Commands

| Command                 | What it does                                   |
| ----------------------- | ---------------------------------------------- |
| `pnpm dev`              | Development server                             |
| `pnpm dev:worker`       | Background worker, watching for changes        |
| `pnpm build`            | Production build, then the service worker      |
| `pnpm start`            | Serve the production build                     |
| `pnpm lint`             | ESLint                                         |
| `pnpm typecheck`        | `tsc --noEmit`                                 |
| `pnpm test`             | Unit and component tests                       |
| `pnpm test:integration` | Integration tests against real PostgreSQL      |
| `pnpm test:all`         | Everything except Playwright                   |
| `pnpm test:e2e`         | Playwright journeys                            |
| `pnpm db:generate`      | Generate a migration from schema changes       |
| `pnpm db:migrate`       | Apply migrations                               |
| `pnpm db:seed`          | Development fixtures                           |
| `pnpm icons`            | Regenerate PWA icons from the wordmark         |
| `pnpm audit:prod`       | Vulnerability check on production dependencies |

## Project layout

```
src/
  app/                    routes, layouts, route handlers
    (auth)/               sign-in, register
    (app)/                dashboard, profile — signed-in users
    groups/[groupId]/     group pages — members and guests
    api/                  route handlers (auth, attachments, health)
  modules/                domain logic, by domain
    auth/                 passwords, sessions, WebAuthn, mail
    groups/               groups, participants, invitations
    participants/
    expenses/             allocation, splits, expense service
    settlements/
    balances/             the balance engine (pure) and its service
    currencies/           ISO 4217, money, conversion
    recurring/            schedule maths and generation
    imports/              Splitwise adapters and staged import
    attachments/          receipts
    activity/             append-only history
  lib/
    db/                   Drizzle schema, client, migrations
    jobs/                 pg-boss wiring
    storage/              local and S3 drivers
    security/             authorization, tokens, guest sessions, rate limits
  components/             React components
  worker/                 worker entrypoint
tests/
  integration/            real-database tests
  e2e/                    Playwright journeys
  fixtures/               anonymised sample files
drizzle/                  committed SQL migrations
```

### The boundaries that matter

These are enforced by ESLint, not just convention:

- **Domain modules do not import React or Next.js.** Services, engines and
  repositories must be usable from the worker, which has no request context.
  The adapter files that bridge the two — `actions.ts`, `actor.ts`,
  `cookies.ts` — are explicitly exempt, because bridging is their job.
- **UI components never query PostgreSQL.** Server Components call module
  services.
- **Services own transactions.** A financial write and its activity event
  commit together, or not at all.
- **Repository queries are scoped by group.** Records are never fetched by bare
  ID and authorized afterwards.

## Testing

### Unit and property tests

```bash
pnpm test
```

Fast, no database. This is where the money rules live: allocation, splits,
currency conversion, the balance engine, recurrence maths. The invariants —
allocations sum to the total, balances sum to zero, conversions are
deterministic — are checked with **fast-check** against randomised inputs, not
just chosen examples.

### Integration tests

```bash
export TEST_DATABASE_URL=postgres://balancia:balancia@localhost:5432/balancia
pnpm test:integration
```

These create a dedicated `<database>_vitest` database, apply the **committed
migrations** (not a schema push, so migrations are themselves under test), and
truncate between tests. They cover transactional integrity, authorization
boundaries, guest isolation, import retry safety, recurring idempotency and
receipt security.

### Playwright journeys

```bash
# A separate database for e2e
createdb balancia_e2e
DATABASE_URL=postgres://balancia:balancia@localhost:5432/balancia_e2e pnpm db:migrate

pnpm build
E2E_DATABASE_URL=postgres://balancia:balancia@localhost:5432/balancia_e2e pnpm test:e2e
```

Playwright starts a **production** build, so the journeys exercise what a
self-hoster actually runs.

Passkey tests drive Chrome's WebAuthn virtual authenticator over CDP: the
browser produces a genuine attestation and assertion, and the server verifies
signature, origin, relying-party ID and challenge. Nothing is stubbed
server-side.

## Changing the database schema

1. Edit the relevant file in `src/lib/db/schema/`.
2. `pnpm db:generate` — writes SQL to `drizzle/`.
3. **Read the generated SQL.** It is committed and applied to real data; a
   review here is cheaper than a migration incident.
4. `pnpm db:migrate` to apply locally.
5. Commit the schema change and the migration together.

Never edit a migration that has already been applied anywhere. The runner
records a checksum per migration and fails loudly if a file changes, which is
the behaviour you want when the alternative is silent divergence.

## Notes on the stack

**Money.** Never `number`. Amounts are `bigint` minor units end to end; they
cross JSON as strings. `src/modules/currencies/money.ts` is the only place that
formats them.

**Server Actions** validate with zod, resolve the actor, then call a service.
No business logic lives in an action or a component.

**TanStack Query** is used only where a client workflow genuinely benefits —
currently just passkey management, whose list changes after a browser-only
ceremony. Page data comes from Server Components.

**The service worker** never caches authentication endpoints, receipts or
mutations, and there is no offline data entry. That is deliberate: queueing
financial writes would need conflict resolution this product does not have.
