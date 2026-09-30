# Data migration

How to bring existing shared-expense history into Balancia — from your own
backup, or from another app.

## Restoring a Balancia backup

Group settings → **Export** → **JSON** produces the canonical file: integer
minor units, every payer and every share, exactly as stored. That file goes
back in through the same import screen — group settings → **Import data**, or
the _Import a backup_ link under the export list.

Restore it into a group you create for it. The import writes into whichever
group you run it from; it does not create one, and it never edits the group's
name, currency mode or timezone.

### What comes back, and what does not

| In the file           | On restore                                              |
| --------------------- | ------------------------------------------------------- |
| Expenses and payments | Restored, amount for amount                             |
| Spending or income    | Restored the way each entry was recorded                |
| Multiple payers       | Restored                                                |
| Categories            | Restored as the code they were filed under              |
| People                | Offered in the preview, matched by name or added as new |
| Recurring expenses    | **Not restored** — set them up again                    |
| Receipts              | **Not in the export at all**                            |
| Converted amounts     | **Not restored** — see _Currency handling_ below        |

Whether an entry was money out or money in comes back with it. A backup
written before Balancia recorded income says nothing about direction, and every
entry in one restores as spending — which is what all of them were.

People are matched by their ID inside the file, not by the name printed beside
each share, so a rename between two exports never splits one person in two.
Where a group held two people with the same display name, the repeat is
numbered (`Ada (2)`) rather than merged, and the preview lets you point each
one at the right person.

Restoring the same file twice is safe: rows are fingerprinted by content, so
the second run skips everything it already wrote.

A backup from a newer version of Balancia is refused rather than half-read —
its `exportVersion` is higher than the one this instance knows.

### Restoring somewhere else

Nothing in the file ties it to the instance that wrote it. The same JSON
restores into a different Balancia — your own server, or somebody else's — as
long as its version is not older than the one that made the file.

---

## Importing from Splitwise

Balancia reads two Splitwise formats:

| Format               | Where it comes from                                      |
| -------------------- | -------------------------------------------------------- |
| **Group CSV export** | Splitwise → open a group → _Export as spreadsheet_       |
| **JSON backup**      | A Splitwise API/backup export containing an expense list |

### The workflow

Importing is deliberately several steps rather than one upload button, because
the interesting decisions — who is who, what will be skipped — need a human.

1. **Create the Balancia group first.** Choose its currency mode now: `separate`
   keeps each currency balanced independently, `converted` folds everything into
   one base currency. This cannot be changed later without reinterpreting every
   amount.
2. Open **Settings → Import data**, or `/groups/<id>/import`.
3. **Upload the file.** It is parsed on your own server. Nothing is sent
   anywhere.
4. **Read the preview.** It reports how many expenses and payments were found,
   which currencies appear, which people the file names, and every row that will
   be skipped along with the reason.
5. **Map the people.** Each name from the export becomes either an existing
   participant or a new one. Exact name matches are pre-selected; check them.
6. **Import.** Everything commits in one transaction.
7. **Read the report**: imported, skipped, failed.

### Re-running an import is safe

Every row gets a fingerprint — a hash of its meaningful content (date,
description, amount, currency, participants) scoped to the group. Committed
fingerprints are stored, so:

- Importing the same file twice imports **nothing** the second time; the preview
  says "5 already imported" before you commit.
- A partially failed import can be retried; rows that already landed are skipped.
- Two exports that overlap only import the rows that are genuinely new.
- A Splitwise payment an older version of the importer took for an expense is
  still known by the expense's fingerprint, so importing the file again does
  not add the payment beside it.

This is checked by an integration test and an end-to-end journey, because
"balances silently doubled" is the worst possible outcome for this feature.

### What comes across

| Splitwise                       | Balancia                                         |
| ------------------------------- | ------------------------------------------------ |
| Expense                         | Expense, with per-person shares as exact amounts |
| Payment / "Settle all balances" | Settlement (a repayment, not spending)           |
| Category                        | Category (free text)                             |
| Date                            | Expense date                                     |
| Currency                        | Currency, kept as-is                             |
| People (columns or `users[]`)   | Participants, per your mapping                   |

**How a payment is told apart in the CSV.** The spreadsheet has no column that
says "this is a payment", so the importer reads one from the row:

- a description of `Payment` or `Settle all balances` (or `Pago`, `Zahlung`),
  or a cost of zero, is a payment whatever else the row says;
- a row in the `Payment` category, or described as `<one person> paid <another>`
  with both names spelled as their columns — `Bob paid Carol`, the way
  Splitwise exports a payment recorded in its app — is a payment when the row
  moves one amount from one person to one other, and nobody else's column
  changes. A `Payment` row that splits a cost between three people is an
  expense somebody filed oddly, and is imported as one.

A payment row that names more than two people — a "Settle all balances" across
a whole group — only gives each person's net, not who paid whom. It is recorded
as one payment for each pair, enough to cover every net, and the preview says
which pairs it chose. Each person's balance comes out exactly as in Splitwise;
the pairs are the importer's.

The JSON backup marks each payment outright (`payment: true`, with the payer's
`paid_share` and the recipient's `owed_share`), so none of this applies to it.
It skips a payment that does not have exactly two parties rather than guess
the pairs.

**Split methods are not preserved as methods.** Splitwise exports the _result_
of a split, not the rule, so every imported expense is stored as an exact-amount
split whose totals match the source exactly. Balances are identical; only the
"split equally" label is lost. Expenses you create in Balancia afterwards keep
their method.

**Imported expenses keep their original currency and carry no exchange rate.**
Inventing a historical rate would be worse than leaving it unset. In a
converted-currency group, review imported foreign-currency expenses and re-enter
them with the rate you want if you need them folded into the base currency.

### If you imported a CSV before October 2026

Until the end of September 2026, the CSV importer read a Splitwise payment the
wrong way round: a payment Blaise made to Ada was recorded as Ada paying
Blaise, which moves both of them by twice the amount. Expenses were read
correctly, and the JSON backup was never affected. Only the rows the preview
counted as payments were — in the file, a row described as `Payment` or
`Settle all balances`, or with a cost of zero.

To check a group, compare its balances with the **Total balance** row at the
end of the file you imported. If they agree to the cent, nothing needs doing.
If they do not, open each payment the import created — dated as in Splitwise,
with the row's description as its note — and swap who paid and who received,
or delete it and record it again.

Do not import the same file again to repair it. A payment now reads the other
way round, so the import no longer recognises it as one it already wrote: it
adds it again beside the reversed copy, and the two cancel out as if the
payment had never happened. If that has already happened, delete the older
copy of each payment, the one going the wrong way.

Two more kinds of row were misread until then:

- **A payment recorded in Splitwise's app** — `Bob paid Carol`, in the
  `Payment` category, with its amount as the cost — came in as an **expense**:
  described `Bob paid Carol`, filed under `Payment`, paid entirely by Bob and
  owed entirely by Carol. The balances are right, because an expense one
  person pays wholly for another moves both of them exactly as the repayment
  does. What is wrong is the spending: the amount counts toward the group's
  total spend, shows as a `Payment` slice in the spending by category, and sits
  in the transactions list as an expense rather than a settlement.

  Nothing needs doing unless you want those figures right. To turn one into
  the repayment it was, delete the expense and record the payment — **Settle
  up** → **Record a payment**, Bob as who paid and Carol as who received it,
  with the same amount and date. Nobody's balance moves.

  Importing the same file again is safe for these rows, and does not convert
  them either: the import knows each one as the expense it wrote, and skips
  it whether that expense is still there or you have already replaced it by
  hand.

- **A "Settle all balances" row naming more than two people** was recorded as
  a single payment between the first two people on it with an amount, for the
  whole of the first one's. Everyone else on the row was left out, so the
  group's balances do not match the **Total balance** row. Correct that
  payment and record the missing ones by hand, as above, until they do.

### What gets skipped, and why

The preview lists every skipped row. Common reasons:

- **Unrecognised date.** Splitwise's own exports use ISO dates; some locales
  produce ambiguous `DD/MM/YYYY`. Unambiguous forms are converted; genuinely
  ambiguous ones are read as `MM/DD/YYYY` (Splitwise's US default) and shown in
  the preview so you can check.
- **Unsupported currency.** Only active ISO 4217 codes are accepted.
- **Unreadable amount.** Both `1,234.56` and `1.234,56` are understood;
  anything else is skipped rather than guessed.
- **Nobody appears to have paid.** A row whose participant columns are all
  zero or negative carries no payer.
- **Totals that do not reconcile** (JSON only). If `paid_share` and `owed_share`
  do not both add up to the expense cost, the row is skipped rather than
  imported unbalanced.
- **Deleted expenses** (JSON only) are ignored.

Export layouts vary by year and locale, so nothing is read positionally:
columns are found by name with several aliases, the separator (`,`, `;` or tab)
is detected, and the trailing "Total balance" summary row is dropped.

### Currency handling

Balancia never converts during an import. If a Splitwise group mixed
currencies:

- In a **separate** group, each currency gets its own balance. Nothing to do.
- In a **converted** group, imported foreign expenses stay in their original
  currency with no rate, so they contribute to their own currency's balance
  until you re-enter them.

The simplest path for a mixed-currency Splitwise group is to import into a
`separate` group.

The same holds for a restored backup. A `converted` group's export carries the
rate each expense was converted at, but the staging model has nowhere to put a
historical rate, so a restored row comes back in the currency it was entered in
and the preview warns how many rows that affects.

---

## Importing from something else

There is no adapter for other services yet — the two that exist read Splitwise
and Balancia's own export. The import layer is built as adapters
(`src/modules/imports/`), each of which turns a file into the same staging
model, so adding one is contained work:

1. Implement `ImportAdapter` — a `detect()` and a `parse()` that produce
   `StagedExpense` and `StagedSettlement` rows.
2. Register it in the adapter list in `src/modules/imports/service.ts`.
3. Add an **anonymised** fixture under `tests/fixtures/` and tests covering the
   sum invariants and the malformed cases.

Everything downstream — preview, participant mapping, fingerprinting,
transactional commit, retry safety — is format-agnostic and comes for free.

Contributions are welcome; see [CONTRIBUTING.md](../CONTRIBUTING.md).

---

## Moving a Balancia instance

Moving between servers is a backup and a restore, not a migration. See
[backup-and-restore.md](backup-and-restore.md).

Two things to watch:

- **Copy the old `.env` across** rather than generating a new one, or the new
  instance cannot open the database it was given.
- **If the domain changes, every passkey stops working.** Credentials are bound
  to the relying-party ID by the authenticator. Passwords are unaffected; users
  register a new passkey on the new domain. To avoid this, set `WEBAUTHN_RP_ID`
  to a parent domain you intend to keep _before_ people register passkeys.

## Leaving Balancia

Your data is yours and it is in a standard PostgreSQL database with a
documented, normalized schema (`src/lib/db/schema/`). To take it elsewhere:

```bash
# Everything, portable
docker compose exec -T db pg_dump -U balancia -d balancia --format=plain --no-owner > balancia.sql

# Or specific tables as CSV
docker compose exec -T db psql -U balancia -d balancia -c \
  "\copy (SELECT * FROM expenses WHERE deleted_at IS NULL) TO STDOUT WITH CSV HEADER" > expenses.csv
```

Amounts are integer minor units — divide by 100 for a two-decimal currency, and
mind that JPY has no minor unit while KWD has three.
