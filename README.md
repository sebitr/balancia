# Balancia

**Shared expenses. Fairly balanced.**

Balancia is a privacy-focused, self-hosted alternative to Splitwise. It tracks
what a group spends, works out who owes whom, and runs entirely on a server you
control — no third party in the middle of your money, no analytics, no
telemetry.

```bash
./scripts/bootstrap.sh && docker compose up -d --build
```

That is the whole installation. The first command generates this instance's own
secrets into a `.env`; the second brings up PostgreSQL 18, applies migrations,
and starts the web app and a background worker.

---

## What it does

- **Splits that always add up.** Equal, exact amount, percentage or
  share-based. Money is stored as integer minor units and allocated with a
  largest-remainder algorithm, so parts sum to the total exactly — every time,
  in every currency.
- **Several payers per expense.** When two people cover one bill, record it
  once; balances follow who actually paid what.
- **Multi-currency, two ways.** Keep each currency balanced separately, or
  convert everything into one base currency at a rate frozen when you record
  it. Historical expenses are never silently recalculated. Daily rates can be
  filled in for you from the European Central Bank's published figures — off by
  default, because a self-hosted instance should decide for itself whether to
  talk to anyone.
- **Passkeys and passwords.** Sign in with a passkey (WebAuthn) or an email and
  password. Both are implemented in this repository — no third-party auth
  service is involved.
- **Guest participation without an account.** Invite someone through a
  revocable link. They can view the group, add and edit expenses, settle up and
  upload receipts — but never manage people, links or the group itself.
- **Receipts kept private.** Images and PDFs live in your own storage behind
  authorization checks. There is no publicly served uploads directory.
- **Recurring expenses.** Rent, subscriptions, the shared internet bill —
  generated on schedule in the group's own timezone, idempotently.
- **Splitwise import.** Upload a CSV export or JSON backup, preview exactly what
  will happen, map the people, then import. Re-importing the same file never
  duplicates anything.
- **Installable PWA.** Works as an app on a phone, with an honest offline
  screen. It does not pretend to accept expenses while offline.

## Screens

The group overview answers, at a glance: total spending, who owes, who should
receive, which currencies are involved, recent activity, and a one-tap way to
add an expense. On a phone that is a bottom navigation bar; on a laptop it is
the same layout, wider.

---

## Why AGPL-3.0-or-later

Balancia is licensed under the **GNU Affero General Public License, version 3 or
later**. See [LICENSE](LICENSE).

The AGPL is the GPL plus one extra obligation, and that obligation is the whole
point for software like this:

> **If you run a modified version of Balancia as a network service, you must
> offer the users of that service the complete corresponding source code of your
> modified version.**

Ordinary open-source licences — and even the plain GPL — do not require this.
Someone could take Balancia, improve it, run it as a hosted service for other
people, and never share the improvements, because they never _distributed_ the
software. The AGPL closes that gap.

Concretely:

| What you do                                             | What you owe                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Run Balancia unmodified, for yourself or your household | Nothing. Use it freely.                                                                  |
| Modify it and run it privately, with no other users     | Nothing. Private changes stay private.                                                   |
| Modify it and let other people use it over a network    | You must offer those users the source of your modified version, under AGPL-3.0-or-later. |
| Distribute Balancia, modified or not                    | The usual GPL obligations: source, licence and notices.                                  |

"Offer the source" means a prominent way for a user of your instance to get it —
a link in your instance's interface is the usual approach.

The licence protects the people who _use_ your instance, which for expense
tracking is exactly who needs protecting: they are trusting your server with
their financial history.

### Dependency licence audit

Every production dependency was checked for AGPL compatibility. Reproduce it:

```bash
pnpm licenses list --prod
```

The result at the time of writing, across ~490 transitive packages:

| Licence                                | Packages | Compatible with AGPL-3.0-or-later                    |
| -------------------------------------- | -------- | ---------------------------------------------------- |
| MIT                                    | 413      | Yes — permissive                                     |
| Apache-2.0                             | 37       | Yes — permissive, explicitly GPLv3-compatible        |
| ISC                                    | 21       | Yes — permissive                                     |
| BSD-2/3-Clause                         | 13       | Yes — permissive                                     |
| BlueOak-1.0.0, 0BSD, MIT-0, Python-2.0 | 5        | Yes — permissive                                     |
| CC-BY-4.0                              | 1        | Yes — `caniuse-lite`, a build-time data file         |
| SIL Open Font License                  | 1        | Yes — the Geist font; OFL covers the font files only |
| **LGPL-3.0-or-later**                  | **1**    | **Yes — see below**                                  |

**The one copyleft dependency, and why it is not a problem.**
`@img/sharp-libvips-*` is the native libvips binary behind `sharp`, which
Next.js pulls in as an optional dependency for image optimisation. It is
LGPL-3.0-or-later.

LGPL-3.0 is explicitly compatible with GPL-3.0, and AGPL-3.0 is compatible with
GPL-3.0, so combining it with AGPL-3.0-or-later code is permitted. The LGPL's
distinctive obligation is that recipients must be able to replace the library:
that is satisfied here, because it ships as a separate, dynamically loaded
binary in `node_modules` that anyone can swap, and Balancia's own source is
available regardless.

**No dependency has a paid tier, usage threshold, licence key or commercial
gate.** Authentication — including password hashing, sessions and the WebAuthn
state machine — is implemented in this repository rather than delegated to an
auth vendor. The one exception is the WebAuthn _protocol_ implementation
(`@simplewebauthn/server`, MIT, no commercial offering), which handles CBOR
decoding, COSE key parsing and signature verification. Hand-rolling that would
be a security liability, not an independence win.

---

## Getting started

### Run it locally with Docker

```bash
git clone https://github.com/your-org/balancia.git
cd balancia
./scripts/bootstrap.sh
docker compose up -d --build
```

Open <http://localhost:3000> and create the first account.

Nothing here ships with a fixed shared secret. `bootstrap.sh` generates the
database password and instance secret into a `.env`, and never overwrites
values that are already there — so it is safe to re-run, and safe to chain in
front of every `up`. **Back that file up:** it is the only copy.

### Run it on a domain

Put Balancia behind an HTTPS reverse proxy and set a handful of variables. See
**[docs/self-hosting.md](docs/self-hosting.md)** for Caddy, Traefik and nginx
examples.

The minimum for a domain install:

```bash
APP_URL=https://balancia.example.com
```

Passkeys require HTTPS (browsers refuse WebAuthn on plain HTTP outside
localhost), and Balancia refuses to start with an internally inconsistent
passkey configuration rather than failing later at the prompt.

### Develop on it

See **[docs/development.md](docs/development.md)**. Everything in containers,
nothing to install but Docker:

```bash
docker compose -f compose.dev.yaml up --build
```

Or on the host, which is faster:

```bash
pnpm install
cp .env.example .env.local     # set DATABASE_URL and AUTH_SECRET
pnpm db:migrate
pnpm db:seed                   # optional sample data
pnpm dev
```

---

## Documentation

| Guide                                                  | What it covers                            |
| ------------------------------------------------------ | ----------------------------------------- |
| [Architecture](docs/architecture.md)                   | How the system is put together and why    |
| [Development](docs/development.md)                     | Local setup, tests, project layout        |
| [Self-hosting](docs/self-hosting.md)                   | Docker, reverse proxies, upgrades         |
| [Environment reference](docs/environment.md)           | Every configuration variable              |
| [Backup and restore](docs/backup-and-restore.md)       | Database, receipts, secrets               |
| [Data migration](docs/data-migration.md)               | Importing from Splitwise                  |
| [Security](SECURITY.md)                                | Reporting a vulnerability, security model |
| [Contributing](CONTRIBUTING.md)                        | How to propose a change                   |
| [Implementation status](docs/implementation-status.md) | What is built, what is not                |

---

## Technology

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 ·
shadcn/ui · PostgreSQL 18 · Drizzle ORM · pg-boss · Serwist · Vitest ·
fast-check · Playwright.

No Redis. No microservices. No external services of any kind at runtime.

## Financial correctness

Money is the part of this application that must not be approximately right:

- Amounts are **integer minor units** in PostgreSQL `bigint` and TypeScript
  `bigint`. No floating point touches a monetary value, anywhere.
- JSON boundaries carry amounts as **strings**, because JSON numbers cannot
  represent large integers safely.
- Exchange rates are PostgreSQL `numeric`, multiplied with a decimal library,
  rounded once, deterministically.
- Currencies with **0, 2 and 3 decimal places** are all handled correctly.
- Allocations use a **largest-remainder** algorithm with stable ordering, so the
  parts always sum to the total and the same inputs always produce the same
  split. Any one-minor-unit rounding difference is shown in the interface, not
  hidden.
- The balance engine guarantees that **all balances sum to zero**, and refuses
  to display a figure if that invariant is ever violated.

These properties are covered by property-based tests (fast-check) that hammer
them with randomised inputs, not just examples.

---

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).
Please read [SECURITY.md](SECURITY.md) before reporting anything
security-related; do not open a public issue for a vulnerability.

## Licence

Copyright (C) 2026 Balancia contributors.

This program is free software: you can redistribute it and/or modify it under
the terms of the GNU Affero General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option) any
later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
PARTICULAR PURPOSE. See the GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
