import type { FaqQuestion } from "@/lib/analytics/events";

/**
 * The homepage's questions, in the order it prints them, by their key in
 * `marketing.faq.items`.
 *
 * Every question, in every language. English used to show six of these and
 * French ten, which left the English page without the questions people
 * actually type — whether it imports from Splitwise, whether it runs on a
 * phone, how it differs from the two apps everybody has heard of. Each is
 * also an entry in the page's structured data and in `/llms-full.txt`, and an
 * answer nobody printed is an answer no search engine or assistant can quote.
 */
export const HOME_QUESTIONS = [
  "free",
  "accounts",
  "sharing",
  "unequal",
  "currency",
  "export",
  "privacy",
  "splitwise",
  "comparison",
  "devices",
  "openSource",
  "selfHost",
] as const satisfies readonly FaqQuestion[];
