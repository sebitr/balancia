# Balancia vs tricount

Balancia and tricount both track shared expenses and calculate how a group can
settle up. The main choice is the operating model: tricount is a managed mobile
service operated by bunq, while Balancia is open-source software that can be
used on its free hosted instance or run on your own server.

This comparison was last checked on **17 August 2026**. tricount can change its
product and policies; its official pages linked below are the authority for its
current service.

## Short answer

- **Choose Balancia** when self-hosting, inspectable source code, control of the
  database and receipts, the ability to leave with complete reusable exports,
  guest access without an account, or precise currency handling matter most.
- **Choose tricount** when native mobile apps, offline expense entry, a managed
  service with no server administration, or supported payment integrations
  matter most.

## Feature and operating model

| Question                             | Balancia                                                                                         | tricount                                                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Who runs it?                         | Use the free hosted instance or run it on your own server.                                       | bunq B.V. owns and operates the application and service.                                                               |
| Is the application open source?      | Yes. The complete application is AGPL-3.0-or-later.                                              | No self-hosted source distribution is offered; its terms restrict reproducing and exploiting the service.              |
| Is it free?                          | Yes. The hosted instance and repository have no paid feature tier.                               | tricount's current feature page presents the app as 100% free, and its help center says Premium was deprecated.        |
| Where is group data stored?          | On the selected Balancia instance. Self-hosters control PostgreSQL and receipt storage.          | In the bunq-operated service and its providers, under tricount's privacy policy.                                       |
| Can a group be shared by link?       | Yes. A revocable link is scoped to one participant in one group and does not require an account. | Yes. Current help describes opening a shared tricount link on a phone and joining through the app.                     |
| Which splits are supported?          | Equal, exact, percentage and weighted shares, with several payers on one transaction.            | Equal splits and uneven splits entered as individual amounts or shares are documented.                                 |
| How is currency handled?             | Keep currencies separate, or freeze a chosen conversion rate with each expense.                  | A tricount has one default currency; foreign expenses are converted at a daily market rate into that currency.         |
| Are expense and income supported?    | Yes, including recurring expenses and recurring income.                                          | Yes. Current product documentation describes expenses, transfers and income; it does not describe recurring entries.   |
| Can data move out in common formats? | Every group exports to JSON, CSV and Excel.                                                      | Current help says the former CSV and PDF export was deprecated; the privacy policy still describes export/portability. |
| Are receipt images supported?        | Yes. Images and PDFs remain on the selected instance behind per-request authorization.           | Yes. Photos, including receipts, are stored and processed through the managed service.                                 |
| Does it have native apps?            | No. Balancia is an installable web app (PWA).                                                    | Yes. tricount is distributed as a mobile app.                                                                          |
| Can expenses be entered offline?     | No. Balancia waits for a connection before accepting financial writes.                           | Yes. tricount advertises offline entry followed by automatic synchronization.                                          |
| Does it move money?                  | No. It records settlements but is not a bank or payment processor.                               | Payment requests, bank connections and card features are available under country- and service-specific conditions.     |
| Who handles operations?              | The hosted service operator, or the self-hoster for their own instance.                          | bunq handles hosting, updates and service operations.                                                                  |

## What both products do well

Both products cover the everyday group-expense workflow: add participants,
record spending, divide costs unevenly, calculate balances, record repayments,
work with foreign currencies and attach supporting images. Both can be a good
choice for a trip, shared home, couple or event.

tricount has the stronger phone-native and offline experience. Balancia is the
stronger fit when the group or operator wants a deployable open-source system,
an auditable financial model and a complete export in reusable data formats.

## Leave anytime with your data

Data portability is a product promise in Balancia, not a paid upgrade or an
operator-only escape hatch. Every group can be downloaded at any time in three
reusable formats:

- **JSON** preserves the complete group record and exact stored amounts;
- **CSV** works with broadly available data tools; and
- **Excel** provides a readable workbook for people who prefer spreadsheets.

Receipts are not yet bundled into those exports, but each attachment can be
downloaded separately. A self-hoster also controls the PostgreSQL database and
receipt storage directly.

This is a material difference from tricount's currently documented product.
Its official help center says the former CSV and PDF export was deprecated. Its
privacy policy still refers to exporting accounts and requesting data
portability, but it does not document a current reusable in-app export format.
Anyone for whom an exit path matters should confirm the available format with
tricount support before entering long-lived group records.

## Privacy and control

With self-hosted Balancia, the operator chooses the server, storage, domain,
email provider and optional integrations. No external service is required at
runtime, telemetry starts off, and local categorization or receipt scanning
does not send expenses to an AI provider.

tricount is owned and operated by bunq. Its privacy policy explains the
financial, identification, device and usage data used to operate and improve
the service, along with processing by service providers. In return, tricount
users do not have to administer a server, database, upgrades or backups.

Self-hosting is control, not zero responsibility. A Balancia operator must
configure HTTPS, protect secrets, apply updates, monitor the instance and test
backups.

## Can I migrate from tricount to Balancia?

Balancia does **not** currently include a tricount importer. Check the current
tricount app or ask its support team what machine-readable data is available
before planning a migration.

Until a documented compatible export is available, moving a tricount to
Balancia requires recreating the participants, opening balances and expenses
manually. Do not delete the original tricount until the new group's balances
have been checked.

## Sources and trademarks

The tricount columns above use its official
[feature overview](https://tricount.com/en-us/expense-tracker-features),
[expense and currency help](https://help.tricount.com/articles/how-can-i-manage-my-tricounts-and-expenses),
[Premium and export notice](https://help.tricount.com/articles/what-happened-with-tricount-premium),
[payment-request help](https://help.tricount.com/articles/tricount-request-links),
[Privacy Policy](https://www.tricount.com/documents/privacy-policy) and
[Terms and Conditions](https://tricount.com/en-us/documents/terms-conditions),
reviewed on 17 August 2026.

tricount is a trademark of its respective owner. Balancia is not affiliated
with, endorsed by or sponsored by tricount or bunq B.V. This comparison is
provided to help people choose a deployment and data-ownership model, not to
imply equivalence between every feature of the two products.

Also see [Balancia vs Splitwise](compare-splitwise.md).
