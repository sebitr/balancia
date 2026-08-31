import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";
import { LOCALES, negotiateLocale, isAppLocale } from "./locales";

/**
 * Guards on the message catalogues.
 *
 * English is the reference: `next-intl.d.ts` types every `t()` call against
 * it, so a missing English key is already a compile error. What the compiler
 * cannot see is a *translation* that has drifted — a key nobody translated, a
 * `{count}` dropped in the French copy, or a plural whose categories were
 * mangled. Those fail here instead of in front of a French-speaking user.
 *
 * Nor can it see a language that is ready to ship and has not been wired up,
 * nor one that was wired up before it was ready. Weblate writes
 * `messages/<code>.json` with every value empty the moment a language is
 * opened for translation, so a file appearing is the start of the work rather
 * than the end of it, and only the values say which.
 */

type Tree = { [key: string]: string | Tree };

/** Flattens to dotted paths so a missing key names itself in the failure. */
function flatten(tree: Tree, prefix = ""): Map<string, string> {
  const flat = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      flat.set(path, value);
    } else {
      for (const [nested, message] of flatten(value, path)) {
        flat.set(nested, message);
      }
    }
  }
  return flat;
}

/**
 * The argument names an ICU message interpolates.
 *
 * Taken from the parsed AST rather than by regex, so plural branches and
 * nested markup are covered and literal braces are not mistaken for
 * placeholders.
 */
function placeholdersOf(locale: string, message: string): Set<string> {
  const names = new Set<string>();

  const walk = (elements: unknown[]): void => {
    for (const element of elements) {
      if (typeof element !== "object" || element === null) continue;
      const node = element as {
        value?: unknown;
        type?: number;
        options?: Record<string, { value: unknown[] }>;
        children?: unknown[];
      };
      // Types 0 (literal) and 8 (pound) carry no argument name.
      if (
        typeof node.value === "string" &&
        node.type !== 0 &&
        node.type !== 8
      ) {
        names.add(node.value);
      }
      if (node.options) {
        for (const option of Object.values(node.options)) {
          walk(option.value);
        }
      }
      if (node.children) walk(node.children);
    }
  };

  walk(new IntlMessageFormat(message, locale).getAst() as unknown[]);
  return names;
}

const english = flatten(en as unknown as Tree);
const french = flatten(fr as unknown as Tree);

/**
 * Every catalogue `messages/` holds, flattened, by language code.
 *
 * Read off disk rather than imported: the whole point is to see the files
 * nothing in `src/` names yet.
 */
const CATALOGUES = new Map(
  readdirSync(new URL("../../messages", import.meta.url))
    .filter((name) => name.endsWith(".json"))
    .map((name): [string, Map<string, string>] => [
      name.slice(0, -".json".length),
      flatten(
        JSON.parse(
          readFileSync(
            new URL(`../../messages/${name}`, import.meta.url),
            "utf8",
          ),
        ) as Tree,
      ),
    ]),
);

/**
 * The English keys a catalogue has no translation for.
 *
 * Weblate writes the complete key set as soon as a language is opened, every
 * value an empty string, so a key being present says nothing — an empty value
 * is an untranslated one. A catalogue that is missing outright counts as
 * untranslated throughout, which is what a locale registered against a file
 * that does not exist should look like.
 */
function untranslated(code: string): string[] {
  const catalogue = CATALOGUES.get(code);
  if (!catalogue) return [...english.keys()];
  return [...english.keys()].filter(
    (key) => (catalogue.get(key) ?? "").trim() === "",
  );
}

describe("message catalogues", () => {
  it("ships a language as soon as its catalogue is finished", () => {
    // A finished translation nobody wired up is invisible: no switcher entry,
    // no negotiation, no email in it. Registering one means naming the code in
    // six places — LOCALES and LOCALE_LABELS in src/i18n/locales.ts, then the
    // catalogue maps in src/i18n/request.ts, src/i18n/emails.ts,
    // src/components/pwa/offline-notice.tsx,
    // src/components/i18n/language-switcher.tsx and tests/helpers/intl.tsx.
    // The last five are `Record<AppLocale, …>`, so `pnpm typecheck` names them
    // one at a time once this test has said the language is ready.
    const ready = [...CATALOGUES.keys()].filter(
      (code) => !isAppLocale(code) && untranslated(code).length === 0,
    );

    expect(ready).toEqual([]);
  });

  it("offers no language that is still being translated", () => {
    // The other direction, and the one that keeps the promise made in
    // docs/translations.md: a language ships when it is complete. A locale in
    // LOCALES whose catalogue still has gaps shows blank strings where the
    // translation is missing — and a locale registered against a skeleton
    // Weblate has only just written shows a blank app.
    const gaps = [...LOCALES]
      .map((locale) => [locale, untranslated(locale)] as const)
      .filter(([, missing]) => missing.length > 0)
      .map(
        ([locale, missing]) =>
          `${locale}: ${missing.length} untranslated, from "${missing[0]}"`,
      );

    expect(gaps).toEqual([]);
  });

  it("translates every English key into French", () => {
    const missing = [...english.keys()].filter((key) => !french.has(key));
    expect(missing).toEqual([]);
  });

  it("has no French key that English does not define", () => {
    const extra = [...french.keys()].filter((key) => !english.has(key));
    expect(extra).toEqual([]);
  });

  it("every message is valid ICU in its own locale", () => {
    for (const locale of LOCALES) {
      for (const [key, message] of CATALOGUES.get(locale) ?? []) {
        expect(
          () => new IntlMessageFormat(message, locale),
          `${locale}: ${key}`,
        ).not.toThrow();
      }
    }
  });

  it("keeps the same interpolated values in every language", () => {
    for (const locale of LOCALES) {
      if (locale === "en") continue;
      const catalogue = CATALOGUES.get(locale) ?? new Map<string, string>();
      for (const [key, source] of english) {
        const translated = catalogue.get(key);
        if (translated === undefined || translated === "") continue;
        expect(
          [...placeholdersOf(locale, translated)].sort(),
          `${locale}: placeholders differ for "${key}"`,
        ).toEqual([...placeholdersOf("en", source)].sort());
      }
    }
  });

  it("leaves no message untranslated by accident", () => {
    // Some values are legitimately identical across languages — a bare
    // placeholder, a product name, a word French borrowed unchanged. Long
    // ones have to be named here, so that "identical" stays a deliberate
    // choice rather than a translation someone forgot.
    const SAME_IN_BOTH = new Set([
      "notificationsPage.metaTitle",
      "notificationsPage.title",
      "notificationsPage.bell",
      // Three rows of the settings hub whose words French borrowed unchanged.
      "userSettings.notifications",
      "userSettings.administration",
      "userSettings.documentation",
      // Two dates and an en dash: there is nothing in it to translate.
      "group.metaSpan",
      // Two placeholders and a comma, same in both.
      "addEntry.repeat.active",
      // A category name and a count of the ones folded in behind it: a
      // placeholder, a plus sign and a placeholder.
      "expensesList.bandRemainder",
      // A date and a payment method, joined by the separator the rest of the
      // app uses. Both halves are already translated where they come from.
      "settleUp.settledOnVia",
      // Product names. Interac and Bancontact Pay are called that in French
      // too — only the two generic methods, `bank` and `cash`, translate.
      "paymentMethods.interac",
      "paymentMethods.payconiq",
      // A sample value, not a sentence: a Swiss street, shown greyed in the
      // field so somebody can see the shape expected of them. There is
      // nothing in it to translate. The phone number and the IBAN that used
      // to sit beside it are a country's business rather than a language's
      // and have moved to `payouts/examples.ts`.
      "payouts.addressStreetHint",
    ]);

    const identical = [...english].filter(
      ([key, source]) => french.get(key) === source,
    );
    const unexpected = identical.filter(
      ([key, source]) =>
        source.length > 12 &&
        !/^\{[a-zA-Z]+\}$/.test(source) &&
        !SAME_IN_BOTH.has(key),
    );
    expect(unexpected.map(([key]) => key)).toEqual([]);
  });
});

describe("locale negotiation", () => {
  it("honours the highest-quality supported language", () => {
    expect(negotiateLocale("fr-CA,fr;q=0.9,en;q=0.8")).toBe("fr");
    expect(negotiateLocale("en-GB,en;q=0.9")).toBe("en");
  });

  it("skips languages it does not have and falls back to English", () => {
    // `qa` and `qb` are in the ISO 639-2 private-use range, so these stay true
    // whatever language Weblate adds next.
    expect(negotiateLocale("qa-QA,qa;q=0.9,fr;q=0.5")).toBe("fr");
    expect(negotiateLocale("qa,qb;q=0.9")).toBe("en");
    expect(negotiateLocale(null)).toBe("en");
    expect(negotiateLocale("")).toBe("en");
  });

  it("ignores a language the browser explicitly refused", () => {
    expect(negotiateLocale("fr;q=0")).toBe("en");
  });

  it("prefers quality order over the order written", () => {
    expect(negotiateLocale("en;q=0.2,fr;q=0.9")).toBe("fr");
  });

  it("recognises exactly the locales the app ships", () => {
    expect(LOCALES.every(isAppLocale)).toBe(true);
    expect(isAppLocale("qa")).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
  });
});
