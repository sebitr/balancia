# Data migration

How to bring existing shared-expense history into Balancia.

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
2. Open **Settings → Import from Splitwise**, or `/groups/<id>/import`.
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

**Split methods are not preserved as methods.** Splitwise exports the _result_
of a split, not the rule, so every imported expense is stored as an exact-amount
split whose totals match the source exactly. Balances are identical; only the
"split equally" label is lost. Expenses you create in Balancia afterwards keep
their method.

**Imported expenses keep their original currency and carry no exchange rate.**
Inventing a historical rate would be worse than leaving it unset. In a
converted-currency group, review imported foreign-currency expenses and re-enter
them with the rate you want if you need them folded into the base currency.

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

---

## Importing from something else

There is no adapter for other services yet. The import layer is built as
adapters (`src/modules/imports/`), each of which turns a file into the same
staging model, so adding one is contained work:

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

- **Restore the secrets volume**, or the new instance cannot open the database
  it was given.
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
