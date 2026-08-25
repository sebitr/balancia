# Balancia documentation

Balancia is a free, open-source shared expense tracker that can be used at
[balancia.app](https://balancia.app) or self-hosted with Docker Compose. This
index routes customers, instance operators and contributors to the shortest
useful guide.

## Choosing Balancia

| Guide                                             | Best for                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [Frequently asked questions](faq.md)              | Short, direct answers about cost, privacy, accounts, currencies, migration and limitations |
| [Balancia vs Splitwise](compare-splitwise.md)     | Deciding between a self-hosted open-source tool and a managed service                      |
| [Balancia vs tricount](compare-tricount.md)       | Comparing data control and complete exports with native apps and offline entry             |
| [Implementation status](implementation-status.md) | What is complete, what is limited and what comes next                                      |

## Running Balancia

| Guide                                       | Best for                                                              |
| ------------------------------------------- | --------------------------------------------------------------------- |
| [Self-hosting](self-hosting.md)             | First install, HTTPS, reverse proxies, upgrades and production checks |
| [Environment reference](environment.md)     | Every configuration variable and its default                          |
| [Backup and restore](backup-and-restore.md) | Protecting and recovering secrets, PostgreSQL data and receipts       |
| [Splitwise migration](data-migration.md)    | Importing a CSV export or JSON backup safely                          |
| [Notifications](notifications.md)           | In-app notifications, Web Push and delivery behavior                  |
| [Email](emails.md)                          | SMTP, verification, password recovery and message previews            |

## Understanding and trusting Balancia

| Guide                                             | Best for                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Security policy and model](../SECURITY.md)       | Authentication, guest access, authorization, uploads and reporting a vulnerability |
| [Financial correctness](financial-correctness.md) | Exact amounts, rounding, currencies, conversions and balance invariants            |
| [Telemetry](telemetry.md)                         | What can be measured, what is never collected and how opt-in works                 |
| [Dependency licensing](licensing.md)              | AGPL obligations and the production dependency policy                              |
| [Receipt scanning](receipt-scanning.md)           | Local OCR, model files, parsing and privacy                                        |
| [Automatic categorization](categorization.md)     | Local rules, confidence and learned overrides                                      |

## Developing Balancia

| Guide                                    | Best for                                                   |
| ---------------------------------------- | ---------------------------------------------------------- |
| [Development](development.md)            | Local setup, tests, project structure and stack notes      |
| [Architecture](architecture.md)          | Boundaries, data flow and design decisions                 |
| [Translations](translations.md)          | Helping translate, adding a language, and the two Weblates |
| [Contributing](../CONTRIBUTING.md)       | Proposing, implementing and verifying a change             |
| [Code of conduct](../CODE_OF_CONDUCT.md) | Community expectations                                     |
| [Support](../SUPPORT.md)                 | Where questions, bugs, ideas and security reports belong   |

## Three useful starting points

- **I want to try it:** open [balancia.app](https://balancia.app).
- **I want to own the deployment:** follow the
  [Docker quick start](self-hosting.md#quick-start).
- **I want to work on the code:** follow [development.md](development.md), then
  read [CONTRIBUTING.md](../CONTRIBUTING.md).
