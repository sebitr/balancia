import { getFormatter, getTranslations } from "next-intl/server";
import type { AppLocale } from "@/i18n/locales";

/**
 * What the two comparison pages say, as data.
 *
 * Read out of the catalogue once and handed on as plain strings, because two
 * things print it: the page a person reads (`comparison-page.tsx`) and the
 * plain-text copy an assistant's crawler is pointed at (`/llms-full.txt`).
 * Built separately they would drift, and the one a reader cannot see is the
 * one that would be wrong.
 *
 * `docs/compare-splitwise.md` and `docs/compare-tricount.md` are the same
 * comparisons in the repository, with the same sources. A claim about either
 * product changes in both places or in neither.
 */

/**
 * The day every claim about the other product was last read off that
 * product's own pages. It is printed on the page, sent as `dateModified`, and
 * is the `lastmod` of both pages in the sitemap — so it moves only when
 * somebody has actually gone and read them again, and never to make a page
 * look fresh.
 */
export const COMPARISON_REVIEWED = "2026-10-05";

export type ComparedProduct = "splitwise" | "tricount";

export interface ComparisonRow {
  key: string;
  question: string;
  balancia: string;
  other: string;
}

export interface ComparisonSection {
  key: string;
  title: string;
  paragraphs: string[];
  /** An ordered procedure, where the section is one. */
  steps?: string[];
}

export interface Comparison {
  product: ComparedProduct;
  /** The other product's name, as this language writes it. */
  name: string;
  meta: { title: string; description: string };
  eyebrow: string;
  title: string;
  titleAccent: string;
  lead: string;
  /** "Checked against … on 5 October 2026 …", already formatted. */
  checked: string;
  verdict: { balancia: string; other: string };
  rows: ComparisonRow[];
  sections: ComparisonSection[];
  faq: { key: string; question: string; answer: string }[];
  sourcesIntro: string;
  sources: { label: string; href: string }[];
  trademark: string;
}

async function reviewedOn(locale: AppLocale): Promise<string> {
  const format = await getFormatter({ locale });
  return format.dateTime(new Date(`${COMPARISON_REVIEWED}T00:00:00Z`), {
    dateStyle: "long",
    timeZone: "UTC",
  });
}

export async function splitwiseComparison(
  locale: AppLocale,
): Promise<Comparison> {
  const [t, common, date] = await Promise.all([
    getTranslations({ locale, namespace: "compare.splitwise" }),
    getTranslations({ locale, namespace: "compare.common" }),
    reviewedOn(locale),
  ]);
  const name = t("name");

  const row = (
    key:
      | "operator"
      | "openSource"
      | "price"
      | "data"
      | "guests"
      | "splits"
      | "currency"
      | "importIn"
      | "exportOut"
      | "receipts"
      | "apps"
      | "offline",
  ): ComparisonRow => ({
    key,
    question: t(`rows.${key}.question`),
    balancia: t(`rows.${key}.balancia`),
    other: t(`rows.${key}.other`),
  });
  const question = (
    key: "free" | "importing" | "limits" | "apps" | "accounts",
  ) => ({
    key,
    question: t(`faq.${key}.question`),
    answer: t(`faq.${key}.answer`),
  });

  return {
    product: "splitwise",
    name,
    meta: { title: t("meta.title"), description: t("meta.description") },
    eyebrow: t("eyebrow"),
    title: t("title"),
    titleAccent: t("titleAccent"),
    lead: t("lead"),
    checked: common("checked", { name, date }),
    verdict: { balancia: t("verdict.balancia"), other: t("verdict.other") },
    rows: [
      row("price"),
      row("openSource"),
      row("operator"),
      row("guests"),
      row("splits"),
      row("currency"),
      row("importIn"),
      row("exportOut"),
      row("data"),
      row("receipts"),
      row("apps"),
      row("offline"),
    ],
    sections: [
      {
        key: "migration",
        title: t("sections.migration.title"),
        paragraphs: [t("sections.migration.note")],
        steps: [
          t("sections.migration.step1"),
          t("sections.migration.step2"),
          t("sections.migration.step3"),
          t("sections.migration.step4"),
        ],
      },
      {
        key: "privacy",
        title: t("sections.privacy.title"),
        paragraphs: [t("sections.privacy.body1"), t("sections.privacy.body2")],
      },
      {
        key: "cost",
        title: t("sections.cost.title"),
        paragraphs: [t("sections.cost.body1"), t("sections.cost.body2")],
      },
    ],
    faq: [
      question("free"),
      question("importing"),
      question("limits"),
      question("accounts"),
      question("apps"),
    ],
    sourcesIntro: t("sources.intro", { date }),
    sources: [
      { label: t("sources.pro"), href: "https://www.splitwise.com/pro" },
      { label: t("sources.terms"), href: "https://www.splitwise.com/terms" },
      {
        label: t("sources.privacy"),
        href: "https://www.splitwise.com/privacy",
      },
      {
        label: t("sources.export"),
        href: "https://feedback.splitwise.com/forums/162446-general/suggestions/3096099-download-export-splitwise-data",
      },
    ],
    trademark: t("trademark"),
  };
}

export async function tricountComparison(
  locale: AppLocale,
): Promise<Comparison> {
  const [t, common, date] = await Promise.all([
    getTranslations({ locale, namespace: "compare.tricount" }),
    getTranslations({ locale, namespace: "compare.common" }),
    reviewedOn(locale),
  ]);
  const name = t("name");

  const row = (
    key:
      | "operator"
      | "openSource"
      | "price"
      | "data"
      | "link"
      | "splits"
      | "currency"
      | "income"
      | "exportOut"
      | "receipts"
      | "apps"
      | "offline"
      | "money",
  ): ComparisonRow => ({
    key,
    question: t(`rows.${key}.question`),
    balancia: t(`rows.${key}.balancia`),
    other: t(`rows.${key}.other`),
  });
  const section = (
    key: "both" | "leave" | "privacy" | "migration",
  ): ComparisonSection => ({
    key,
    title: t(`sections.${key}.title`),
    paragraphs: [t(`sections.${key}.body1`), t(`sections.${key}.body2`)],
  });
  const question = (
    key: "free" | "importing" | "exporting" | "apps" | "accounts",
  ) => ({
    key,
    question: t(`faq.${key}.question`),
    answer: t(`faq.${key}.answer`),
  });

  return {
    product: "tricount",
    name,
    meta: { title: t("meta.title"), description: t("meta.description") },
    eyebrow: t("eyebrow"),
    title: t("title"),
    titleAccent: t("titleAccent"),
    lead: t("lead"),
    checked: common("checked", { name, date }),
    verdict: { balancia: t("verdict.balancia"), other: t("verdict.other") },
    rows: [
      row("exportOut"),
      row("openSource"),
      row("operator"),
      row("price"),
      row("link"),
      row("splits"),
      row("currency"),
      row("income"),
      row("data"),
      row("receipts"),
      row("apps"),
      row("offline"),
      row("money"),
    ],
    sections: [
      section("leave"),
      section("both"),
      section("privacy"),
      section("migration"),
    ],
    faq: [
      question("free"),
      question("exporting"),
      question("importing"),
      question("accounts"),
      question("apps"),
    ],
    sourcesIntro: t("sources.intro", { date }),
    sources: [
      {
        label: t("sources.features"),
        href: "https://tricount.com/en-us/expense-tracker-features",
      },
      {
        label: t("sources.help"),
        href: "https://help.tricount.com/articles/how-can-i-manage-my-tricounts-and-expenses",
      },
      {
        label: t("sources.premium"),
        href: "https://help.tricount.com/articles/what-happened-with-tricount-premium",
      },
      {
        label: t("sources.requests"),
        href: "https://help.tricount.com/articles/tricount-request-links",
      },
      {
        label: t("sources.privacy"),
        href: "https://www.tricount.com/documents/privacy-policy",
      },
      {
        label: t("sources.terms"),
        href: "https://tricount.com/en-us/documents/terms-conditions",
      },
    ],
    trademark: t("trademark"),
  };
}

export const COMPARISONS: Record<
  ComparedProduct,
  (locale: AppLocale) => Promise<Comparison>
> = {
  splitwise: splitwiseComparison,
  tricount: tricountComparison,
};

/**
 * The comparison as Markdown, for `/llms-full.txt`.
 *
 * The table is a real table and each claim a whole sentence, so that a model
 * lifting one row out of it still has the product's name beside the fact.
 */
export function comparisonMarkdown(
  comparison: Comparison,
  labels: {
    shortAnswer: string;
    chooseBalancia: string;
    chooseOther: string;
    question: string;
    faqTitle: string;
    sourcesTitle: string;
  },
  url: string,
): string {
  const cell = (text: string) => text.replace(/\|/g, "\\|");
  const lines = [
    `## ${comparison.title} ${comparison.titleAccent}`,
    "",
    url,
    "",
    comparison.lead,
    "",
    comparison.checked,
    "",
    `### ${labels.shortAnswer}`,
    "",
    `- **${labels.chooseBalancia}** ${comparison.verdict.balancia}`,
    `- **${labels.chooseOther}** ${comparison.verdict.other}`,
    "",
    `| ${labels.question} | Balancia | ${comparison.name} |`,
    "| --- | --- | --- |",
    ...comparison.rows.map(
      (row) =>
        `| ${cell(row.question)} | ${cell(row.balancia)} | ${cell(row.other)} |`,
    ),
    "",
  ];

  for (const section of comparison.sections) {
    lines.push(`### ${section.title}`, "");
    section.steps?.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
    if (section.steps) lines.push("");
    for (const paragraph of section.paragraphs) lines.push(paragraph, "");
  }

  lines.push(`### ${labels.faqTitle}`, "");
  for (const { question, answer } of comparison.faq) {
    lines.push(`**${question}** ${answer}`, "");
  }

  lines.push(`### ${labels.sourcesTitle}`, "", comparison.sourcesIntro, "");
  for (const source of comparison.sources) {
    lines.push(`- [${source.label}](${source.href})`);
  }
  lines.push("", comparison.trademark, "");

  return lines.join("\n");
}
