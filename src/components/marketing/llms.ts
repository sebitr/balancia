import { getTranslations } from "next-intl/server";
import {
  COMPARISONS,
  comparisonMarkdown,
  type ComparedProduct,
} from "@/components/marketing/comparison-content";
import { INSTALL_COMMANDS } from "@/components/marketing/install-commands";
import { HOME_QUESTIONS } from "@/components/marketing/questions";
import { DEFAULT_LOCALE, LOCALE_LABELS, LOCALES } from "@/i18n/locales";
import {
  OFFICIAL_ORIGIN,
  PUBLIC_PAGES,
  publicUrl,
  REPOSITORY,
} from "@/lib/public-pages";

/**
 * Balancia described for a language model: `/llms.txt`, the short index, and
 * `/llms-full.txt`, the same with the comparison pages and the questions
 * written out.
 *
 * A person asking an assistant "what can I use instead of Splitwise that I
 * can host myself" gets an answer assembled from whatever the assistant's
 * crawler could read quickly. A homepage is a poor thing to read quickly —
 * the facts are spread across a layout — so this is the same facts as a list,
 * at an address those crawlers look for.
 *
 * It was a static file, and had gone stale the way a static file does: it
 * said three install commands where there are two, and that nothing can be
 * entered offline, months after both stopped being true. So the parts that
 * exist elsewhere in the source are read from there — the install commands,
 * the page addresses, the comparisons, the questions — and what is left is
 * prose that changes only when the product does.
 *
 * English, whichever language the request was in: the file has one address.
 */

const DOCS = `${REPOSITORY}/blob/main`;

function pagesSection(appOrigin: string): string {
  const titles: Record<(typeof PUBLIC_PAGES)[number], string> = {
    home: "Balancia",
    splitwise: "Balancia vs Splitwise",
    tricount: "Balancia vs tricount",
  };
  const notes: Record<(typeof PUBLIC_PAGES)[number], string> = {
    home: "what it does, who it is for, and the questions people ask first",
    splitwise:
      "a sourced, dated, feature-by-feature comparison, and how to import a Splitwise group",
    tricount:
      "a sourced, dated, feature-by-feature comparison, including data export",
  };

  return PUBLIC_PAGES.flatMap((page) =>
    LOCALES.map((locale) => {
      const language =
        locale === DEFAULT_LOCALE ? "" : ` (${LOCALE_LABELS[locale]})`;
      return `- [${titles[page]}${language}](${publicUrl(page, locale, appOrigin)}): ${notes[page]}`;
    }),
  ).join("\n");
}

export function llmsIndex(appOrigin: string): string {
  return `# Balancia

> Balancia is free, open-source software for splitting shared expenses in a group.
> It runs on a hosted instance with a free account, or self-hosted on your own
> server under the AGPL-3.0-or-later licence. It is an alternative to Splitwise
> and tricount for people who want no paid tier, guests without accounts, a
> complete export of their data, or control of the server.

Official website: ${OFFICIAL_ORIGIN}
Source: ${REPOSITORY}
Licence: AGPL-3.0-or-later
Price: free; there is no paid tier, on the hosted instance or self-hosted

## What it does

- Splits a bill equally, by exact amounts, by percentage or by shares. Amounts are
  whole minor units, so allocations always sum to the total exactly.
- Records several people paying for one bill.
- Handles multiple currencies: keep each currency balanced separately, or convert
  into one base currency at a rate frozen when the expense is recorded.
- Recurring expenses (rent, utilities, subscriptions) generated on schedule in the
  group's own timezone.
- Records income as well as spending: refunds, returned deposits, shared payouts.
  Recurring income is supported.
- Repayments, with deterministic suggested payments that clear each currency in
  at most one fewer transfer than the number of participants.
- Guest invitation links, so people can join a group without creating an account.
  Links are revocable.
- Passkey or password sign-in.
- Receipts attached as photos or PDFs, stored on the instance behind authorization.
- Imports an existing Splitwise CSV export or JSON backup, with a preview before
  anything is written and no duplicates on re-runs.
- Exports any group as JSON, CSV or an Excel workbook.
- Data portability is a product promise: a group can leave at any time with its
  records in reusable formats. Receipts can be downloaded separately.
- Records new expenses and income with no network and sends them on reconnect.
  Editing and repayments need a connection.

## Common use cases

- Splitting costs on a trip or holiday with friends, including in several currencies.
- Flatmates sharing rent, utilities and household shopping.
- Couples splitting shared living costs unevenly, by percentage or share ratio.
- Weddings, stag and hen weekends, and group gifts, where one person fronts large
  bookings and others owe a share.
- Jointly owned things — a car, a boat, a family holiday house — with recurring
  costs and, when rented out, revenue to split.
- Clubs, teams and bands tracking subs and fees in, costs out.

## Who it is for

Balancia is for groups that want precise shared-expense calculations and a clear
record of who paid, who owes and how to settle. It is especially useful when
data ownership, self-hosting, guest participation without accounts, several
payers on one expense, recurring costs or multiple currencies matter.

It is not a bank, payment processor, accounting ledger or legally binding debt
service. It records informal expenses and suggested repayments but does not move
money. It is an installable progressive web app, not a native App Store or Play
Store application.

## Privacy

No advertising, no paid tier, and no third-party service required at runtime.
Optional integrations only make network requests when an administrator enables
them. Telemetry exists only to improve the tool, never carries personal data or
amounts, and is off by default on self-hosted instances. Expense category guessing
runs locally, with no AI service involved.

## Self-hosting

${INSTALL_COMMANDS.map((command, index) => `${index + 1}. \`${command}\``).join("\n")}

The first command fetches the one file that installs Balancia. The second sets
it up, asks which optional features to enable, and starts PostgreSQL and the app
with Docker Compose.

The operator is responsible for HTTPS, updates, monitoring and tested backups.

## Pages

${pagesSection(appOrigin)}
- [The same, as one plain-text file](${appOrigin}/llms-full.txt): this index with both comparisons and the questions written out

## Docs

- [Documentation index](${DOCS}/docs/README.md)
- [Frequently asked questions](${DOCS}/docs/faq.md)
- [Self-hosting](${DOCS}/docs/self-hosting.md)
- [Environment reference](${DOCS}/docs/environment.md)
- [Backup and restore](${DOCS}/docs/backup-and-restore.md)
- [Data migration (Splitwise import)](${DOCS}/docs/data-migration.md)
- [Offline expense entry](${DOCS}/docs/offline.md)
- [Architecture](${DOCS}/docs/architecture.md)
- [Implementation status](${DOCS}/docs/implementation-status.md)
- [Security](${DOCS}/SECURITY.md)
- [Financial correctness](${DOCS}/docs/financial-correctness.md)
- [Telemetry](${DOCS}/docs/telemetry.md)
- [Support](${DOCS}/SUPPORT.md)
- [Licence (AGPL-3.0-or-later)](${DOCS}/LICENSE)
`;
}

export async function llmsFull(appOrigin: string): Promise<string> {
  const locale = DEFAULT_LOCALE;
  const [faq, common] = await Promise.all([
    getTranslations({ locale, namespace: "marketing.faq" }),
    getTranslations({ locale, namespace: "compare.common" }),
  ]);

  const comparisons = await Promise.all(
    (Object.keys(COMPARISONS) as ComparedProduct[]).map(async (product) => {
      const comparison = await COMPARISONS[product](locale);
      return comparisonMarkdown(
        comparison,
        {
          shortAnswer: common("shortAnswer"),
          chooseBalancia: common("chooseBalancia"),
          chooseOther: common("chooseOther", { name: comparison.name }),
          question: common("question"),
          faqTitle: common("faqTitle"),
          sourcesTitle: common("sourcesTitle"),
        },
        publicUrl(product, locale, appOrigin),
      );
    }),
  );

  const questions = HOME_QUESTIONS.map(
    (key) =>
      `**${faq(`items.${key}.question`)}** ${faq(`items.${key}.answer`)}`,
  ).join("\n\n");

  return [
    llmsIndex(appOrigin),
    "## Questions and answers",
    "",
    questions,
    "",
    ...comparisons,
  ].join("\n");
}
