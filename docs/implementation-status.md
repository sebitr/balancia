# Implementation status

The initial production version is complete. Everything below is implemented,
wired end to end, and covered by tests — there are no placeholder screens and no
`TODO` stubs in core functionality.

## Phases

| #   | Phase                                                   | Status |
| --- | ------------------------------------------------------- | ------ |
| 1   | Repository and tooling foundation                       | ✅     |
| 2   | Environment validation                                  | ✅     |
| 3   | PostgreSQL schema and committed migrations              | ✅     |
| 4   | Money and allocation domain                             | ✅     |
| 5   | Balance engine                                          | ✅     |
| 6   | Authentication (email/password + passkeys, first-party) | ✅     |
| 7   | Groups, participants and central authorization          | ✅     |
| 8   | Secure guest access                                     | ✅     |
| 9   | Expenses and settlements                                | ✅     |
| 10  | Activity history                                        | ✅     |
| 11  | Responsive application interface                        | ✅     |
| 12  | Multi-currency modes (separate and converted)           | ✅     |
| 13  | Receipt storage (local + S3)                            | ✅     |
| 14  | Recurring expenses and worker                           | ✅     |
| 15  | Splitwise staged import                                 | ✅     |
| 16  | PWA configuration                                       | ✅     |
| 17  | Docker Compose                                          | ✅     |
| 18  | Documentation                                           | ✅     |
| 19  | CI and final verification                               | ✅     |

## Verification

Last full run on macOS with Node 24.19, pnpm 11.20 and PostgreSQL 18.4:

| Check               | Result                                        |
| ------------------- | --------------------------------------------- |
| `pnpm install`      | Succeeds                                      |
| `pnpm lint`         | Clean                                         |
| `pnpm typecheck`    | Clean                                         |
| `pnpm format:check` | Clean                                         |
| `pnpm test:all`     | **251 passed**, 15 files (unit + integration) |
| `pnpm test:e2e`     | **26 passed** (desktop + mobile projects)     |
| `pnpm build`        | Succeeds; service worker precaches 40 URLs    |
| `pnpm audit --prod` | No known vulnerabilities                      |

## Notable design decisions made during implementation

**Authentication is first-party.** The original plan delegated to an auth
framework; it was replaced with an implementation in this repository, because a
self-hosted application should not depend on a vendor with a commercial tier.
Passwords use Node's built-in scrypt, sessions are random tokens stored as
hashes, and the WebAuthn state machine is ours. Only the WebAuthn _protocol_
(CBOR/COSE parsing, signature verification) is delegated, to
`@simplewebauthn/server` — MIT, no company, no paid tier. Hand-rolling that
would be a security liability rather than an independence win.

**Serwist runs in configurator mode.** The default `withSerwist` plugin is
webpack-only, and Next.js 16 builds with Turbopack. `pnpm build` therefore runs
`next build` followed by `serwist build`, which produces the same service worker
without opting the whole app out of Turbopack.

**`server-only` is aliased away in non-Next contexts.** It is a bundler-time
guard that throws under plain Node, so the worker and migrator bundles alias it
to a no-op and Vitest resolves it likewise. The guard still does its job where
it matters — inside the Next.js build.

## Known limitations

These are deliberate omissions for this version, not oversights:

- **No offline data entry.** The service worker caches an app shell and does
  network-first for authenticated views, but queuing financial writes offline
  would require conflict resolution the product was not asked for. The offline
  screen says so plainly.
- **Guest history claiming is designed, not built.** `participants.user_id` is
  nullable specifically so a guest participant can later be linked to an
  account; the UI flow for doing so is not implemented.
- **Imported expenses lose their split _method_.** Splitwise exports the result
  of a split, not the rule, so imports are stored as exact-amount splits.
  Balances are identical; only the "split equally" label is absent.
- **Imported expenses carry no exchange rate.** Inventing a historical rate
  would be worse than leaving it unset. In a converted group, re-enter foreign
  imports if you need them folded into the base currency.
- **The currency mode is fixed at group creation.** Changing it would
  reinterpret every amount already recorded.
- **Docker was not executed on this machine.** The Dockerfile, `compose.yaml`
  and the secret bootstrap are written and reviewed, and the bundles they run
  (`dist/worker.js`, `dist/migrate.js`) were built and smoke-tested directly on
  the host — the worker started, subscribed to all queues and shut down
  gracefully on SIGTERM; the migrator applied migrations. But this machine has
  no Docker daemon, so `docker compose up -d --build` itself has not been run.
  CI builds the image and checks its entrypoints and non-root user.
- **No email delivery was exercised end to end.** SMTP paths are implemented and
  gated behind configuration; without a mail server the instance works fully and
  simply does not offer verification or recovery.

## Next priorities

1. **Run `docker compose up -d --build` on a Docker host** and confirm a healthy
   stack, then add that to CI as an integration smoke test.
2. **Guest account claiming**: let a guest create an account and inherit their
   participant history. The schema already supports it.
3. **Expense list pagination and filtering.** The list currently loads up to 200
   entries; groups with years of history need cursor pagination, plus filters by
   participant, category and date.
4. **Exchange-rate provider (opt-in).** The `exchange_rate_source` column
   already distinguishes `manual` from other sources; a provider would fill
   rates automatically while keeping them frozen per expense.
5. **CSV/JSON export**, closing the loop on data portability.
