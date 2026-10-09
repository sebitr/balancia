# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is a **group member on a phone**: someone a friend, flatmate or
partner has handed a link or a nudge, who wants to log a bill and see where they
stand, often at a restaurant table or in the middle of a trip, and who is not
necessarily technical. Design decisions that pull apart are settled in their
favour.

Behind them, in order:

- the person who runs a group (creates it, invites the others, chases
  settlements, reads the statistics), on a phone and increasingly on a laptop;
- the self-hosting operator, who installs and maintains an instance and cares
  about backups, email, telemetry and trust as much as the app.

The groups are trips, shared homes, couples (including uneven splits such as
60/40), families, clubs, teams and bands, with recurring costs or shared income.

## Product Purpose

Balancia is a free, open-source shared-expense tracker and a self-hostable
alternative to Splitwise and tricount. Someone records what each person paid,
chooses how to divide it, and Balancia works out who owes whom and which
repayments clear the group. Success is a group that settles up without an
argument or a spreadsheet, and a person who can leave with all of their data
whenever they like.

## Positioning

The three claims a neighbouring product could not truthfully copy, as confirmed
by the owner:

- **Open source and self-hostable.** AGPL-3.0-or-later, one app container plus
  PostgreSQL, no third-party service required at runtime, every group exportable
  as JSON, CSV or Excel.
- **Free with nothing held back.** No paid tier, no payment card, no feature
  reserved. The hosted instance, the demo, the translation platform and the
  domains are paid for out of pocket.
- **No account needed to join in.** A revocable guest link, or a group's shared
  link, lets a newcomer view the group, add expenses, settle up and upload
  receipts. A first group can start with just a name; the account comes later,
  when there is something to keep.

## Operating Context

- **Hosted app** at balancia.app, a **live demo** at demo.balancia.app (one
  click, no sign-up, an account of your own pre-filled with a Lisbon trip and a
  flat share, swept a couple of hours later), and **self-hosting** with Docker
  Compose via a `bootstrap.sh` wizard.
- An installable PWA, not an App Store or Play Store download. It shows a clear
  offline screen but accepts no financial entries offline.
- Phone first. Desktop layouts (home, sidebar, transactions table, entry dialog,
  settle-up and detail screens) are being built out; see `todo/now/`.
- English and French, with language, date format, number format and display
  currency chosen independently. Further languages are translated on Weblate.
- Self-hosters own HTTPS, updates, monitoring and backups. Telemetry is off by
  default for them.

## Capabilities and Constraints

- Splits: equal, exact amounts, percentages and weighted shares; several payers
  on one expense; expenses and income; recurring entries in the group's
  timezone.
- Multi-currency groups either balance each currency separately or convert into
  one base currency at a rate frozen when the expense is recorded. A total is
  one figure per currency, never an invented combined one.
- Suggested repayments are deterministic. Groups are sorted on Home into the
  ones that need you and the ones that owe you.
- Receipts (images and PDFs) are stored privately on the instance, local or
  S3-compatible. Optional categorisation and receipt scanning run on the
  instance; expense data is not sent to an external AI service.
- Import a Splitwise CSV or JSON export with a preview and without duplicates on
  re-run. tricount import does not exist.
- Passkeys and passwords, implemented in the repository. No third-party identity
  service.
- Financial correctness is a product requirement, not a feature: money is
  integer minor units, every allocation sums exactly to the total, every set of
  balances sums to zero or is refused, exchange rates are decimals frozen with
  the expense.
- Terminology: _group_, _entry_ (expense, income or repayment), _settle up_,
  _guest_, _instance_.
- The money colours carry fixed meanings that the user's accent never overrides:
  green means somebody owes you, red means you owe, amber marks who paid.
  `AGENTS.md` holds the rules and their reasons.
- The marketing homepage (`src/app/page.tsx`, `src/components/marketing/`) is an
  editorial surface with its own scale and is outside the product's type rules.

## Brand Commitments

- **Name and mark:** Balancia, with the icon in `public/icons/`. The default
  accent is plum; seven accents are offered and the reader chooses one.
- **Voice** (read from the repository, not separately confirmed): plain,
  candid, understated. It states what the product is not ("young software
  maintained by a small open-source project", "does not import tricount data
  directly") and writes comparison pages that name the other product's
  strengths.
- Comparison facts carry a `COMPARISON_REVIEWED` date that moves only on a day
  somebody has re-read the other product's own pages.

## Evidence on Hand

- A live demo and a hosted instance that can be opened and screenshotted.
- Screenshots captured from the demo in `docs/assets/` (group overview, split,
  settle up, home, add expense, expenses, multi-currency, import, statistics).
- Candid decision guides in `docs/compare-splitwise.md` and
  `docs/compare-tricount.md`; the FAQ and `docs/implementation-status.md`.
- A design system transcription in `design-system/` (kit and preview pages),
  synced to a claude.ai design project.
- Absent, and not to be invented: testimonials, user or group counts, press,
  store listings, benchmark claims, named customers.

## Product Principles

1. **Build for the person at the table.** The group member on a phone, in a hurry
   and not technical, decides first; the organiser, the laptop and the operator
   follow.
2. **Useful before an account.** Nobody should have to register to take part. The
   account arrives when there is something to keep.
3. **Nothing held back, nothing locked in.** No feature is paywalled and every
   group can be exported whole; leaving is always possible, and saying so is
   part of the product.
4. **A balance is a statement, not a colour.** Every figure carries a sign and a
   word; colour never carries the meaning alone.
5. **Say what it is and what it is not.** Describe the product at its real
   maturity, to the people deciding whether to trust it with their money.

## Accessibility & Inclusion

- Text and balance figures meet 4.5:1 against every surface in every accent, and
  7:1 when the system asks for increased contrast (`prefers-contrast: more`).
- Text-entry fields are never smaller than 16px on a phone, so iOS Safari does
  not zoom the page.
- Colour never carries meaning alone: every figure has a sign and a word beside
  it.
- Interface languages are English and French today; the layout must survive
  longer translations and different number and date formats.
