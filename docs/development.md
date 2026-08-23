# Development

Two ways to run Balancia while working on it. [In Docker](#setup-in-docker)
needs nothing on your machine but a container runtime. [On the host](#setup-on-the-host)
is faster and integrates better with editors and debuggers. Both end up at
<http://localhost:3000>, and they share nothing, so you can switch freely.

## Setup: in Docker

```bash
docker compose -f compose.dev.yaml up --build     # or: pnpm dev:docker
```

That builds the development image and starts PostgreSQL 18, the migrations, the
Next.js dev server with hot reload, the background worker in watch mode, and
Mailpit. First run takes a few minutes — mostly `pnpm install` inside the
container; later starts are seconds.

| Where                                                   | What                                                |
| ------------------------------------------------------- | --------------------------------------------------- |
| <http://localhost:3000>                                 | The app                                             |
| <http://localhost:8025>                                 | Mailpit — every email the app sends, caught locally |
| `postgres://balancia:balancia@127.0.0.1:55432/balancia` | PostgreSQL, published for host tooling              |

Your working tree is mounted into the containers, so an edit on the host is
what the dev server compiles. `node_modules` and `.next` deliberately are _not_
shared with the host: the host's are built for macOS, the containers need Linux
binaries. When the lockfile changes, the container reinstalls on next start —
no rebuild needed.

Seed data, a shell inside the app environment, and shutdown:

```bash
docker compose -f compose.dev.yaml run --rm seed      # or: pnpm dev:docker:seed
docker compose -f compose.dev.yaml run --rm shell     # pnpm, drizzle-kit, vitest
docker compose -f compose.dev.yaml down               # add -v to drop the database
```

Because PostgreSQL is published on 55432, host-side `pnpm db:generate`,
`pnpm test:integration` and `psql` all work against the containerised database
with the `DATABASE_URL` already in `.env.local`.

Overridable ports: `DEV_APP_PORT`, `DEV_DB_PORT`, `DEV_MAILPIT_UI_PORT`,
`DEV_MAILPIT_SMTP_PORT`. Log level: `DEV_LOG_LEVEL`.

Exchange-rate suggestions are off in the dev stack too, for the same reason
they are off in production — they reach a third party. To work on them:

```bash
DEV_EXCHANGE_RATE_PROVIDER=frankfurter pnpm dev:docker
```

**Stop any host-side server on 3000 first.** If a `pnpm dev` or `pnpm start` is
already listening there, Docker will still report the port as published — it
binds the IPv4 address while the Node process holds the IPv6 one — and
`localhost:3000` resolves to IPv6 first. The result is that you appear to be
testing the container while every request goes to the host process. Check with
`lsof -nP -iTCP:3000 -sTCP:LISTEN`, or set `DEV_APP_PORT` to something else.

**The container runs webpack, not Turbopack.** It is the one deliberate
difference from a host `pnpm dev`. Turbopack's file watcher does not fire for a
bind-mounted tree — not even for edits made inside the container, and
`watchOptions.pollIntervalMs` does not help — so it serves a stale compile
indefinitely, which is worse than being slow. Webpack polls and picks up an
edit in about a second. Bundler-specific behaviour is therefore worth
confirming with a host `pnpm dev` before you trust it. `DEV_BUNDLER_FLAG=--turbopack`
switches back once upstream watching works.

`compose.dev.yaml` is for development only — fixed public secrets, no
hardening, source mounted live. Production self-hosting is `compose.yaml`, a
different image built from `Dockerfile`.

## Setup: on the host

### Prerequisites

- **Node.js 24 LTS**
- **pnpm 11** — the version is pinned in `packageManager`; run `corepack enable`
  and it will use the right one
- **PostgreSQL 18** — locally, or in Docker

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
| `pnpm weblate`          | Local Weblate for wording and languages        |
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
  i18n/                   locale negotiation, formats, catalogue loading
messages/                 en.json and fr.json — every translated string
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

## Installing Balancia (PWA)

The service worker and the install experience are separate concerns. Serwist
owns the former (see `serwist.config.mjs`); everything about _offering_ the
install lives in `src/components/pwa/`.

`use-install-prompt.ts` is the single source of truth. It is a module-level
store rather than React state, because `beforeinstallprompt` fires exactly
once and can arrive before anything mounts. Components read it through
`useSyncExternalStore`, whose server snapshot offers nothing at all — so the
server renders no install affordance and the client fills one in after
hydration. Nothing ever appears and then vanishes.

It resolves one of four methods, and no component checks a browser itself:

| Method        | Where                               | What the user gets               |
| ------------- | ----------------------------------- | -------------------------------- |
| `prompt`      | Android and desktop Chromium        | The browser's own install sheet  |
| `ios-share`   | Safari on iOS and iPadOS            | Share → Add to Home Screen steps |
| `ios-browser` | Chrome, Edge, Firefox, Opera on iOS | "Open in Safari"                 |
| `unavailable` | Installed, or Firefox and friends   | Nothing                          |

Two entry points, deliberately unequal. **The account menu** carries
"Install Balancia" and stays available for as long as installing is possible.
**The dashboard** additionally shows a one-time suggestion, but only on the
branch where the visitor already belongs to a group — a new account never
meets it on first load. Waving that suggestion away is persisted to
`localStorage` and never asked again; the menu action is unaffected, because
dismissal should silence a nudge, not remove a choice.

### Manual QA

Automated tests mock the browser APIs — `beforeinstallprompt` is Chromium-only
and standalone mode is not something jsdom or Playwright enters. So the matrix
below is checked by hand against a build served over HTTPS (installability
requires a secure origin; `localhost` counts, a LAN IP does not).

| Scenario                      | Expected                                                              |
| ----------------------------- | --------------------------------------------------------------------- |
| Android Chrome                | Menu action present; opens the native dialog; installs                |
| Android Chrome, after install | Action gone; home-screen launch opens standalone                      |
| Android Brave / Edge          | Same as Chrome — nothing keys off "Chrome" specifically               |
| Firefox for Android           | No install action anywhere                                            |
| iPhone Safari                 | Action present; opens the share-sheet steps; add to Home Screen works |
| iPhone Safari, standalone     | No install action                                                     |
| iPhone Chrome / Edge          | "Open in Safari"; never an Android-style prompt                       |
| iPad Safari                   | Detected as iOS despite the desktop user agent                        |
| Desktop Chrome / Edge         | Menu action present; native prompt works                              |
| Desktop Firefox / Safari      | No install action                                                     |

Check the sheet in both themes, and on a notched iPhone — it pads for
`safe-area-inset-bottom`.

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

**Form controls never go below 16px on a phone.** Safari on iOS zooms the page
in when a field smaller than that takes focus, and it does not zoom back out
afterwards — the layout is left scaled up until the reader pinches out by hand.
So anything typed into or picked from — `<input>`, `<textarea>`, `<select>` —
carries `text-base`, and its real size comes back at `md:` and up:
`text-base md:text-sm`. `Input` and `Textarea` already do this, so a call site
only has to keep it when it overrides the size. Buttons and Radix triggers are
exempt; the browser only zooms for controls it can put a caret or a picker in.

Two things now hold that line without anyone remembering it.
`src/app/globals.css` puts a `font-size: max(1rem, 1em)` floor under every
`input`, `textarea` and `select` below `md`, which catches the control that
states no size at all and inherits one — the case that actually shipped, an
invisible `<input type="date">` over the entry form's date row picking up the
`text-sm` that `SheetContent` sets on everything inside it. The floor lives in
`@layer base`, so any explicit `text-*` still outranks it and the amount
field's `text-[44px]` is untouched. What the floor cannot catch is a size
stated explicitly and stated too small, so
`src/components/ui/text-entry-size.test.ts` scans the source for exactly that
and fails the build. Note that the phone scale is a point larger than the
desk one, which makes `text-sm` 15px on a phone — still under the line, and
still a failure.

**Sheets and dialogs sit above the keyboard, not under it.** A phone keyboard
does not shorten the layout viewport; it slides over it. So anything positioned
against that viewport — a bottom sheet anchored to the bottom edge, a dialog
centred with `top-1/2` — keeps its place while the keyboard covers the lower
half of it, fields and submit button included. `useKeyboardInset` measures what
`visualViewport` has lost and `SheetContent`, `DialogContent` and
`AlertDialogContent` all spend it: the sheet lifts its `bottom`, the two
dialogs re-centre on what is left and cap their height. A new surface that
holds a field and positions itself by hand needs the same hook.
