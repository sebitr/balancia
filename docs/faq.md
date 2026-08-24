# Balancia frequently asked questions

Short answers to the questions people ask before using or self-hosting
Balancia.

## What is Balancia?

Balancia is free, open-source software for splitting shared expenses. A group
records who paid, who benefited and how each transaction should be divided;
Balancia calculates the balances and suggests the payments needed to settle up.

It works for trips, shared homes, couples, families, events, clubs, teams and
other groups where the same people regularly share costs or income.

## Is Balancia a Splitwise alternative?

Yes. Balancia covers the core shared-expense workflow and can import a
Splitwise CSV export or JSON backup. Its defining difference is control: you
can run Balancia on your own server, inspect the complete source code and keep
the database and receipts on infrastructure you choose.

Read [Balancia vs Splitwise](compare-splitwise.md) for a fair comparison,
including the responsibilities that come with self-hosting.

## Is Balancia a tricount alternative?

Yes. Both products record group expenses, divide costs and calculate how to
settle up. Balancia is designed for people who want open-source software,
self-hosting, complete JSON/CSV/Excel exports or control over how currencies
are balanced. tricount is a managed mobile service with native apps and offline
expense entry.

Balancia does not currently import tricount data directly. Read
[Balancia vs tricount](compare-tricount.md) for the feature, privacy and
migration differences.

## Is Balancia free?

Yes. [balancia.app](https://balancia.app) offers free accounts without asking
for a payment card, and no feature is reserved for a paid plan. The source code
is available under the AGPL-3.0-or-later licence.

Self-hosting software is free, but the server, domain, storage, email delivery
and operational time are the operator's responsibility.

## Does everyone in a group need an account?

No. A member can create a revocable guest link for one participant. A guest can
view the group, add and edit expenses, record settlements and upload receipts.
Guests cannot manage people, invitations, ownership or group settings.

The link grants access to that participant, so it should be shared privately
and revoked if it reaches the wrong person.

## Which split methods are supported?

An expense or income entry can be divided:

- equally;
- by exact amounts;
- by percentages; or
- by weighted shares, such as three shares to two.

One transaction can also have several payers. Balancia validates that the
payers' amounts and the participants' allocations match the total exactly.

## How does Balancia avoid rounding errors?

Money is stored as integer minor units: cents for EUR and USD, whole units for
JPY, and thousandths for KWD. Splits use a deterministic largest-remainder
allocation, so the parts always add up to the original total. Balancia also
asserts that every set of balances sums to zero.

The [financial correctness guide](financial-correctness.md) explains the model
and its tests.

## How does multi-currency expense splitting work?

When a group is created, it chooses one of two modes:

1. **Separate currencies:** EUR, USD, JPY and every other currency keep their
   own balances and settlements.
2. **Converted:** each foreign expense is converted into the group's base
   currency using a rate stored with that expense.

Stored exchange rates never silently change later. An administrator can enable
daily rate suggestions drawn from central-bank data for 165 currencies, or
users can enter a rate manually.

## Can I import an existing Splitwise group?

Yes. Upload a Splitwise CSV export or JSON backup, inspect the preview, map
people to accounts and confirm the import. The same file can be processed again
without duplicating previously imported records.

See the [migration guide](data-migration.md) for supported fields and known
limits.

## Can I export or leave with my data?

Yes. Any group can be downloaded as:

- JSON containing the complete group record with exact stored amounts;
- CSV for broad compatibility; or
- an Excel workbook.

Every row in the CSV and the workbook says whether the entry was spending or
income, so a total taken from the file does not add the two together.

Self-hosters also control the PostgreSQL database and receipt storage directly.
Receipts are not yet bundled into the group export and must be downloaded
separately.

This portability is intentional: you should be able to leave Balancia without
losing access to the records you created or needing a paid export feature.

## Does Balancia send expense data to an AI service?

No. Automatic category suggestions and optional receipt scanning run locally
on the Balancia instance. Imported files are also parsed on the instance.

Optional services such as email, push delivery, S3-compatible storage, exchange
rate suggestions or Sign in with Apple make network requests only when an
administrator explicitly configures them.

## What telemetry does Balancia collect?

A self-hosted instance starts with telemetry off. An administrator can opt in
to one anonymous weekly report and can inspect the exact payload before it is
sent. Reports contain version, enabled-feature flags and activity ranges. They
never contain amounts, names, group names, receipts, identifiers, IP addresses
or the instance address.

The full contract is documented in [telemetry.md](telemetry.md).

## How hard is Balancia to self-host?

The basic install is three commands after cloning the repository:

```bash
./scripts/bootstrap.sh
docker compose up -d --build
```

Docker Compose starts PostgreSQL, runs migrations, launches the web app and
launches one background worker. A production instance also needs a domain,
HTTPS, backups, updates and monitoring. The
[self-hosting guide](self-hosting.md) includes Caddy, Traefik and nginx examples.

## Does Balancia have a mobile app?

Balancia is an installable progressive web app. On supported phones and
desktops it can be added to the home screen and launched like an app. There is
no separate App Store or Play Store package.

## Does Balancia work offline?

Balancia provides an offline screen and caches the application shell, but it
does not accept or queue expense changes without a connection to the instance.
Financial writes need conflict resolution, so the product is explicit instead
of pretending an offline entry was saved.

## Is Balancia production-ready?

The initial production feature set is implemented and tested, and the hosted
instance runs the same repository. Balancia is still young software maintained
by a small project: there are no long-term-support branches, native mobile apps
or high-availability deployment automation.

Review [implementation-status.md](implementation-status.md), including known
limitations, before using it for a critical deployment.

## Which licence does Balancia use?

Balancia uses AGPL-3.0-or-later. You can run it unmodified for yourself or an
organization. If you modify it and let other people use that version over a
network, you must offer those users the corresponding source code under the
same licence.

The [licensing guide](licensing.md) explains common cases in plain language.

## Where can I get help?

Use the route that matches the request:

- questions and setup help: [GitHub Discussions](https://github.com/sebitr/balancia/discussions);
- reproducible bugs: [bug report](https://github.com/sebitr/balancia/issues/new?template=bug_report.yml);
- product ideas: [feature request](https://github.com/sebitr/balancia/issues/new?template=feature_request.yml);
- vulnerabilities: follow [SECURITY.md](../SECURITY.md) and do not post publicly.

See [SUPPORT.md](../SUPPORT.md) for what information to include.
