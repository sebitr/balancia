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
      // An income category French spells exactly as English does.
      "expenses.incomeCategories.contributions",
      // Two names and an arrow: there is nothing in it to translate.
      "addEntry.saved.settledPair",
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

/**
 * Guards on the French copy itself.
 *
 * The catalogue was written in layers, and the layers disagreed: two
 * apostrophe characters interleaved inside single namespaces, 130 strings
 * missing the non-breaking space French wants before its double punctuation,
 * fourteen strings that vouvoyaient a reader the other 2 700 tutoient, and
 * six French words for "settled up". Every one of those is mechanical, which
 * is why they belong here rather than in a reviewer's patience — the same
 * reasoning as `type-scale.test.ts` and `text-entry-size.test.ts`.
 *
 * The marketing homepage is held to the same rules as the rest. It was
 * written separately, in `vous`, which put a change of register at the door
 * of the product — and the same sentence in two voices either side of it,
 * `marketing.cta.registrationClosed` against `register.closedBody`.
 */
describe("French copy", () => {
  it("types every apostrophe as U+2019", () => {
    // A straight quote is also ICU's escape character, so this is not only a
    // typographic preference: `d'{name}` would swallow the placeholder.
    const straight = [...french]
      .filter(([, message]) => /\p{L}'\p{L}/u.test(message))
      .map(([key]) => key);

    expect(straight).toEqual([]);
  });

  it("holds double punctuation to the word before it", () => {
    // French sets a space before « ; ! ? % » and inside guillemets. It has to
    // be non-breaking, or a narrow phone wraps the question mark onto a line
    // of its own. `::` is an ICU number skeleton, not punctuation.
    const loose = [...french]
      .filter(
        ([, message]) =>
          / [;!?%»]/.test(message) ||
          / :(?!:)/.test(message) ||
          /« /.test(message),
      )
      .map(([key]) => key);

    expect(loose).toEqual([]);
  });

  it("addresses the reader as tu, homepage included", () => {
    // Balancia tutoies. `vous` is correct only where a string addresses more
    // than one person at once, which is rare enough to name. The invitation
    // sent to the rest of the group is not one of them: it is read by one
    // person at a time, in their own chat, and tutoies like everything else.
    const ADDRESSES_SEVERAL = new Set([
      // "lequel d'entre vous vient de l'ouvrir" — the group, not the reader.
      "onboarding.welcome.sharedSub",
      // "Entre vous deux" — the reader and one other member.
      "memberStats.eyebrowBetween",
    ]);

    // Two signals, because a string can vouvoyer without a pronoun in it:
    // `Réessayez, ou saisissez la dépense` had neither `vous` nor `votre`.
    // Four letters before `-ez` keeps `chez`, `assez` and `nez` out of it.
    const vouvoie = [...french]
      .filter(
        ([key, message]) =>
          !ADDRESSES_SEVERAL.has(key) &&
          (/\b(vous|votre|vos)\b/i.test(message) ||
            /\b\p{L}{4,}ez\b/u.test(message)),
      )
      .map(([key]) => key);

    expect(vouvoie).toEqual([]);
  });

  it("keeps one French word per idea", () => {
    // The left-hand side is a word that drifted in; the right-hand side is
    // the word the app settled on. Add a pair here rather than letting a
    // second synonym in — a reader moving between two screens should not
    // meet two vocabularies.
    const INSTEAD: [RegExp, string, Set<string>][] = [
      [
        /\bécritures?\b/i,
        "transaction",
        new Set([
          // "L'écriture des dates" and "avant toute écriture" are the ordinary
          // noun, not the bookkeeping sense this rule is about.
          "userSettings.languageNote",
          "importPage.intro",
        ]),
      ],
      [/\bpasskeys?\b/i, "clé d'accès", new Set()],
      [/\bmonnaies?\b/i, "devise", new Set()],
      [/\bréglages?\b/i, "paramètre", new Set()],
      [/\brèglements?\b/i, "remboursement", new Set()],
      [/\bjustificatifs?\b/i, "reçu", new Set()],
      [
        /\brappels?\b/i,
        "relance",
        new Set([
          // The reminder drafts are the message the reader sends, where
          // "petit rappel" is what a French speaker actually writes.
          ...Object.keys(
            (fr as unknown as { remind: { drafts: Record<string, string> } })
              .remind.drafts,
          ).map((draft) => `remind.drafts.${draft}`),
        ]),
      ],
    ];

    const drifted = [...french].flatMap(([key, message]) =>
      INSTEAD.filter(
        ([pattern, , allowed]) => !allowed.has(key) && pattern.test(message),
      ).map(([, preferred]) => `${key}: use "${preferred}"`),
    );

    expect(drifted).toEqual([]);
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
