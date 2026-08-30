# Implementation status

The initial production version is complete. Everything below is implemented,
wired end to end, and covered by tests — there are no placeholder screens and no
`TODO` stubs in core functionality.

**Audited against the source on 30 August 2026**, at `c5f803a6`. Several
entries had outlived what they described: guest claiming, expense search and
filtering, and keyset pagination were all listed here as unbuilt or upcoming
while shipping, and two end-to-end failures were still named after their
assertions had been fixed. A file whose whole job is to say what is and is not
done is worse than useless when it is behind — somebody choosing this software
reads it, and so does anybody deciding what to build next. Re-audit it whenever
a limitation here stops being true.

## Phases

| #   | Phase                                                   | Status |
| --- | ------------------------------------------------------- | ------ |
| 1   | Repository and tooling foundation                       | ✅     |
| 2   | Environment validation                                  | ✅     |
| 3   | PostgreSQL schema and committed migrations              | ✅     |
| 4   | Money and allocation domain                             | ✅     |
| 5   | Balance engine                                          | ✅     |
| 6   | Authentication (email/password + passkeys, first-party) | ✅     |
| 6b  | Sign in with Apple (optional, off by default)           | ✅     |
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
| 20  | Exchange-rate provider (opt-in)                         | ✅     |
| 21  | Group export (JSON, CSV, XLSX)                          | ✅     |
| 22  | Automatic expense categorization (EN/FR)                | ✅     |
| 23  | Notifications: in-app inbox and Web Push (opt-in)       | ✅     |
| 24  | On-device receipt scanning (opt-in)                     | ✅     |
| 25  | Privacy-preserving telemetry (off by default, opt-in)   | ✅     |
| 26  | Local operational metrics (Prometheus, off by default)  | ✅     |
| 27  | Guest access claimed into an account                    | ✅     |
| 28  | Onboarding: passkey signup, email codes, joining a link | ✅     |
| 29  | Payout methods and payment codes                        | ✅     |
| 30  | Group and member statistics                             | ✅     |
| 31  | Transaction search, filtering and keyset pagination     | ✅     |
| 32  | Offline expense entry with a send queue                 | ✅     |

## Verification

Last run on macOS with Node 24.20, pnpm 11.20 and PostgreSQL 18.6, against
`main` at `c5f803a6`:

| Check               | Result                                          |
| ------------------- | ----------------------------------------------- |
| `pnpm install`      | Succeeds                                        |
| `pnpm lint`         | Clean                                           |
| `pnpm typecheck`    | Clean                                           |
| `pnpm format:check` | **Fails on 9 files** — formatting only          |
| `pnpm test:all`     | **3130 passed**, 206 files (unit + integration) |
| `pnpm test:e2e`     | Not re-run in this pass — see below             |
| `pnpm build`        | Compiles                                        |
| `pnpm audit --prod` | No known vulnerabilities                        |

The PostgreSQL note that used to sit here is settled: this run was against the
18 that Compose ships, not the 14 an earlier one used.

`pnpm format:check` is the one red row, and it is nine files of Prettier
disagreement rather than anything behavioural — `pnpm exec prettier --write .`
closes it. It is listed rather than quietly fixed because this table is meant
to say what a fresh clone actually does.

The two end-to-end failures this section used to describe — the percentage
wording in `expenses.spec.ts` and the "1 payments" plural in `import.spec.ts` —
are gone: neither assertion exists in those specs any more. The suite itself
was not re-run in this pass, so the row above says so rather than claiming a
number nobody measured.

## Notable design decisions made during implementation

**Authentication is first-party.** The original plan delegated to an auth
framework; it was replaced with an implementation in this repository, because a
self-hosted application should not depend on a vendor with a commercial tier.
Passwords use Node's built-in scrypt, sessions are random tokens stored as
hashes, and the WebAuthn state machine is ours. Only the WebAuthn _protocol_
(CBOR/COSE parsing, signature verification) is delegated, to
`@simplewebauthn/server` — MIT, no company, no paid tier. Hand-rolling that
would be a security liability rather than an independence win.

Sign in with Apple was added later on the same terms, and needed no dependency
at all: it is one ES256 assertion to sign and one RS256 token to verify against
a published key set, which `node:crypto` does directly. It is off unless an
operator configures it, both because it is the one sign-in path that contacts a
third party and because Apple only issues the credentials to a paid Developer
Program member.

**Serwist runs in configurator mode.** The default `withSerwist` plugin is
webpack-only, and Next.js 16 builds with Turbopack. `pnpm build` therefore runs
`next build` followed by `serwist build`, which produces the same service worker
without opting the whole app out of Turbopack.

**Rate provenance is decided server-side.** The form can suggest a rate, but it
does not get to say where the saved rate came from. On write, the service asks
the rate cache whether the submitted rate is the one this instance actually
fetched for that pair and day, and labels the row `api` only then — so
`exchange_rate_source` stays a fact rather than a claim by the client.

**Web Push is implemented rather than depended on.** The protocol is ECDH over
P-256, HKDF, AES-128-GCM and an ES256 JWT — all of it in `node:crypto`, and all
of it specified precisely enough to implement in about two hundred lines. The
maintained JavaScript library for this brings five direct dependencies to audit
for that, which does not sit well with a dependency list reviewed by hand. The
encryption is verified by a round trip whose receiving half is written from the
RFC rather than from the sending code, deriving each key from the source a real
receiver would use — so an ordering mistake in the key derivation fails the
authentication tag instead of passing symmetrically.

**One table is both the inbox and the outbox.** A notification row is written
in the same transaction as the change it describes, so the inbox cannot
announce something that rolled back. The same row's `pushed_at` is what push
delivery claims, with an `UPDATE … WHERE pushed_at IS NULL`, which makes
delivery exactly-once whether the queued job or the five-minute sweep reaches
it first — and removes the need for a separate outbox table and its poller.

**The XLSX writer is ours; only the ZIP container is not.** An `.xlsx` file is a
ZIP of XML parts, and the maintained JavaScript libraries for writing one are
either an order of magnitude larger than the feature or stale on npm — neither
sits well with a dependency list that is audited by hand. The writer in
`src/modules/exports` emits the smallest valid subset (inline strings, no
shared-string table, no styles) on top of `fflate`, which is MIT with zero
transitive dependencies. The output is verified by unzipping it in the tests,
and was checked against an independent OOXML parser before shipping. Money is
written as the decimal literal the money module already produced, never via a
JavaScript number.

**`server-only` is aliased away in non-Next contexts.** It is a bundler-time
guard that throws under plain Node, so the worker and migrator bundles alias it
to a no-op and Vitest resolves it likewise. The guard still does its job where
it matters — inside the Next.js build.

## Known limitations

These are deliberate omissions for this version, not oversights:

- **Offline entry covers adding, not editing or settling.** Expenses and income
  can be recorded with no network and are sent on reconnect; see
  `docs/offline.md`. Editing an existing entry and recording a repayment both
  still need a server — the first because a stale copy replayed over a row
  somebody else has changed is the one real conflict here, the second because a
  repayment is priced from balances no device can compute on its own.
- **A group is only available offline once its add screen has been opened on
  that device.** That is when the snapshot the offline form renders from is
  written. Loading the roster on every group navigation, so that a group never
  visited could be added to, was not worth the query.
- **Imported expenses lose their split _method_.** Splitwise exports the result
  of a split, not the rule, so imports are stored as exact-amount splits.
  Balances are identical; only the "split equally" label is absent.
- **Imported expenses carry no exchange rate.** Inventing a historical rate
  would be worse than leaving it unset. In a converted group, re-enter foreign
  imports if you need them folded into the base currency.
- **The currency mode is fixed at group creation.** Changing it would
  reinterpret every amount already recorded.
- **The `.env` bootstrap has not been run under Docker.** `scripts/bootstrap.sh`
  and `scripts/docker-entrypoint.sh` were exercised directly on the host — the
  script generates and is idempotent, and the entrypoint assembles a correctly
  percent-encoded `DATABASE_URL`, honours an explicit override, and `exec`s its
  command with the right exit code. `docker compose config` resolves, and a
  missing `.env` fails with a message naming the fix. But `docker compose up -d
--build` itself has not been run against this change, so the image build and
  in-container migration have not been observed end to end. CI builds the image
  and checks its entrypoints and non-root user.
- **No email delivery was exercised end to end.** SMTP paths are implemented and
  gated behind configuration; without a mail server the instance works fully and
  simply does not offer verification, recovery or the six-digit codes.
- **No payment QR has been scanned by a real banking app.** The Swiss payload
  is asserted line for line against Annex A example 3 of the Implementation
  Guidelines, and the Girocode against EPC069-12's field order and its 331-byte
  and version-13 limits — but a passing test is not a bank accepting a payment.
  The four standards added since — SPAYD, the Polish ZBP code, the Pix BR Code
  and Swish — are held to the same bar and carry the same caveat. The BR Code
  is read back by a tag-length-value parser written from the specification
  rather than from the builder, and its checksum is anchored to the published
  CRC-16/CCITT-FALSE check value; the two values most worth a real-device check
  are named in [settling-up.md](settling-up.md).
- **The payout read path has no _integration_ test.** `listPayoutsOwed` is
  exercised end to end by `payouts.spec.ts`, which reads a real debt row as the
  person who owes it, so the read path does run against a database. What is
  still missing is a test that attacks the permission rule directly — that a
  recipient is reachable only by appearing in a debt the balances computed —
  rather than confirming it from the outside.

## Next priorities

1. **Restore a green `pnpm format:check`.** Nine files disagree with Prettier;
   the command is in CI, so the branch protection this table describes is
   currently red for a reason nobody has to read code to fix.
2. **Run `docker compose up -d --build` on a Docker host** and confirm a healthy
   stack, then add that to CI as an integration smoke test.
3. **Receipts in the export.** The data leaves as JSON, CSV or XLSX and the
   workbook names a receipt count per expense, but the attachments themselves
   still have to be downloaded one expense at a time. A single archive would
   finish the job — and it is the last gap in the promise that a group can
   leave with everything.
4. **A default split preference.** Every other split control is here; what is
   missing is remembering the one a group uses most, so the common case stops
   being retyped.
