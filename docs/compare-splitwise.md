# Balancia vs Splitwise

Balancia and Splitwise both answer the same everyday question: after a group
shares expenses, who owes whom? The main decision is not the arithmetic. It is
whether you want a managed commercial service or open-source software that you
can host and operate yourself.

This comparison was last checked on **17 August 2026**. Splitwise can change
its product and pricing; its official pages linked below are the authority for
its current service.

## Short answer

- **Choose Balancia** when control of the server and data, inspectable source,
  guest access without accounts, deterministic money handling or complete
  group exports matter most.
- **Choose Splitwise** when you want an established managed service and native
  mobile apps, and do not want to operate a server.

## Feature and operating model

| Question                                     | Balancia                                                                                              | Splitwise                                                                                                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Who runs it?                                 | Use the free hosted instance or run it on your own server.                                            | Splitwise, Inc. provides and operates the service.                                                       |
| Is the application open source?              | Yes. The complete application is AGPL-3.0-or-later.                                                   | No self-hosted source distribution is offered on its service pages.                                      |
| Is there a paid feature tier?                | No. Every feature is in the repository and the hosted instance has no paid plan.                      | Yes. Splitwise offers a Pro subscription with additional features and limits.                            |
| Where is group data stored?                  | On the chosen Balancia instance. Self-hosters control its PostgreSQL database and receipt storage.    | In Splitwise's managed service and its service providers, as described by its privacy statement.         |
| Can someone participate without registering? | Yes, through a revocable link scoped to one participant in one group.                                 | The standard Splitwise flow is account-based.                                                            |
| Which splits are supported?                  | Equal, exact, percentage and weighted shares, with several payers on one transaction.                 | Splitwise supports shared bills and debts; consult its current product for exact plan-dependent options. |
| How is currency handled?                     | Keep each currency separate or freeze a conversion rate with each expense.                            | Splitwise advertises currency conversion as a Pro feature using current rates.                           |
| Can existing data move in?                   | Imports Splitwise group CSV exports and account JSON backups with a preview and duplicate protection. | Splitwise's own help pages document CSV exports and a complete JSON backup for Pro accounts.             |
| Can data move out?                           | Every group exports to JSON, CSV and Excel.                                                           | Official help documents per-group CSV export and a complete JSON backup for Pro accounts.                |
| Are receipts private?                        | Stored on the selected instance behind per-request authorization.                                     | Stored and processed as part of the managed Splitwise service.                                           |
| Does it have native apps?                    | No. Balancia is an installable web app (PWA).                                                         | Yes. Splitwise provides web and native mobile applications.                                              |
| Does it accept offline entries?              | No. It shows an honest offline screen and waits for a connection.                                     | Check the current Splitwise apps for offline behavior.                                                   |

## Privacy and control

With self-hosted Balancia, the operator chooses the server, storage, domain,
email provider and optional integrations. The application requires no external
service at runtime, and telemetry starts off. Local categorization and optional
receipt scanning do not send expenses to an AI provider.

That control also creates responsibility: the operator must apply updates,
configure HTTPS, protect secrets, monitor the instance and test backups.
Splitwise takes on the hosting work, while its privacy statement governs how
the service and its vendors process information.

## Migration from Splitwise to Balancia

1. Export the Splitwise group as CSV, or download the account JSON backup if it
   is available on the account.
2. In Balancia, open the destination group's **Import** page.
3. Upload the file and review the groups, people, expenses and settlements in
   the preview.
4. Map imported people to Balancia participants, then confirm.

Balancia records a fingerprint for imported data. Running the same import again
does not duplicate it. See [data-migration.md](data-migration.md) for details
and limitations.

## What self-hosting costs

Balancia does not charge a software licence or subscription fee. A self-hosted
operator still pays the real infrastructure costs: compute, storage, backups,
domain registration and possibly email delivery. They also own the operational
work.

If the goal is simply to split a dinner with no setup, the hosted Balancia
instance or a managed service is the easier choice. Self-hosting is valuable
when control is worth that responsibility.

## Sources and trademarks

The Splitwise columns above use Splitwise's official
[Terms of Service](https://www.splitwise.com/terms),
[Privacy Statement](https://www.splitwise.com/privacy),
[Pro page](https://www.splitwise.com/pro) and
[export guidance](https://feedback.splitwise.com/forums/162446-general/suggestions/3096099-download-export-splitwise-data),
reviewed on 17 August 2026.

Splitwise is a trademark of Splitwise, Inc. Balancia is not affiliated with,
endorsed by or sponsored by Splitwise, Inc. The comparison is provided to help
people choose a deployment and data-ownership model, not to imply equivalence
between every feature of the two products.

Also see [Balancia vs tricount](compare-tricount.md).
