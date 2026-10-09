import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOME_QUESTIONS, homeQuestions } from "./questions";

/**
 * The homepage prints these, the structured data repeats them and
 * `/llms-full.txt` quotes them, so a key with no words in one language is a
 * question that renders as its own key path in front of a reader.
 */

function messages(locale: "en" | "fr") {
  const file = path.join(process.cwd(), "messages", `${locale}.json`);
  return JSON.parse(readFileSync(file, "utf8")) as {
    marketing: {
      faq: { items: Record<string, { question?: string; answer?: string }> };
    };
  };
}

describe("homepage questions", () => {
  it.each(["en", "fr"] as const)("are all written in %s", (locale) => {
    const items = messages(locale).marketing.faq.items;

    for (const key of HOME_QUESTIONS) {
      expect(items[key]?.question, `${locale}: ${key}`).toBeTruthy();
      expect(items[key]?.answer, `${locale}: ${key}`).toBeTruthy();
    }
  });

  it("all print where AI assistants are on", () => {
    expect(homeQuestions(true)).toEqual(HOME_QUESTIONS);
  });

  it("leave out the one about AI assistants where an administrator switched them off", () => {
    // `/mcp` answers 404 there, so the page cannot say yes.
    const printed = homeQuestions(false);

    expect(printed).not.toContain("assistants");
    expect(printed).toHaveLength(HOME_QUESTIONS.length - 1);
  });
});
