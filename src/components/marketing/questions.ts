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
  "assistants",
  "openSource",
  "selfHost",
] as const satisfies readonly FaqQuestion[];

/**
 * What a page prints, which is `HOME_QUESTIONS` less the one about AI
 * assistants on an instance whose administrator has switched them off
 * (`AGENT_ACCESS`). A page that answers "can I use it with Claude?" with a
 * yes, when `/mcp` answers 404 there, is the one place the homepage would be
 * lying about the instance it is served from. `/llms-full.txt` describes the
 * software rather than the instance and keeps every question.
 */
export function homeQuestions(
  assistants: boolean,
): readonly (typeof HOME_QUESTIONS)[number][] {
  return HOME_QUESTIONS.filter((key) => assistants || key !== "assistants");
}
