import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import {
  scheduleSentence,
  weekdayName,
  type ScheduleShape,
} from "./schedule-sentence";

/**
 * A schedule in words, through the shipped catalogues — the sentence a reader
 * sees in the repeat sheet, on the entry form's row and in the Recurring list,
 * which is one sentence now.
 */

type Catalogue = typeof en;

function say(
  catalogue: Catalogue,
  locale: "en" | "fr",
  shape: Partial<ScheduleShape>,
): string {
  const schedule = catalogue.recurring.schedule;
  const sentence = scheduleSentence(
    {
      frequency: "monthly",
      interval: 1,
      weekday: null,
      weekOfMonth: null,
      dayOfMonth: 1,
      monthOfYear: null,
      startDate: "2026-10-06",
      ...shape,
    },
    {
      weekday: (day) => weekdayName(locale, day),
      week: (week) => schedule.week[week],
      dayMonth: (day) =>
        new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "long",
          timeZone: "UTC",
        }).format(new Date(`${day}T00:00:00Z`)),
    },
  );
  return String(
    new IntlMessageFormat(schedule[sentence.key], locale).format(
      sentence.values,
    ),
  );
}

describe("a monthly rule in English", () => {
  it.each([
    [1, "Every month on the 1st"],
    [2, "Every month on the 2nd"],
    [3, "Every month on the 3rd"],
    [4, "Every month on the 4th"],
    [11, "Every month on the 11th"],
    [12, "Every month on the 12th"],
    [13, "Every month on the 13th"],
    [21, "Every month on the 21st"],
    [22, "Every month on the 22nd"],
    [23, "Every month on the 23rd"],
    [31, "Every month on the 31st"],
  ])("says day %i as an ordinal", (day, sentence) => {
    expect(say(en, "en", { dayOfMonth: day })).toBe(sentence);
  });

  it("counts the months between", () => {
    expect(say(en, "en", { interval: 3, dayOfMonth: 5 })).toBe(
      "Every 3 months on the 5th",
    );
  });

  it("names the weekday of a nth-weekday rule", () => {
    expect(
      say(en, "en", { weekOfMonth: 2, weekday: 2, dayOfMonth: null }),
    ).toBe("Every month on the second Tuesday");
    expect(
      say(en, "en", { weekOfMonth: "last", weekday: 5, dayOfMonth: null }),
    ).toBe("Every month on the last Friday");
  });
});

describe("the other rules in English", () => {
  it("says a daily rule", () => {
    expect(say(en, "en", { frequency: "daily" })).toBe("Every day");
    expect(say(en, "en", { frequency: "daily", interval: 2 })).toBe(
      "Every 2 days",
    );
  });

  it("says a weekly rule by its weekday's name, not its number", () => {
    expect(say(en, "en", { frequency: "weekly", weekday: 1 })).toBe(
      "Every week on Monday",
    );
    expect(
      say(en, "en", { frequency: "weekly", weekday: 5, interval: 2 }),
    ).toBe("Every 2 weeks on Friday");
  });

  it("takes a weekly rule's day from its start when it names none", () => {
    // 6 October 2026 is a Tuesday.
    expect(say(en, "en", { frequency: "weekly", weekday: null })).toBe(
      "Every week on Tuesday",
    );
  });

  it("says a yearly rule with its month, from the start when it names none", () => {
    expect(say(en, "en", { frequency: "yearly", dayOfMonth: 15 })).toBe(
      "Every year on October 15",
    );
    expect(
      say(en, "en", { frequency: "yearly", dayOfMonth: 31, monthOfYear: 2 }),
    ).toBe("Every year on February 29");
  });
});

describe("in French", () => {
  it("says the 1st as le 1er and every other day plainly", () => {
    expect(say(fr, "fr", { dayOfMonth: 1 })).toBe("Tous les mois, le 1er");
    expect(say(fr, "fr", { dayOfMonth: 5 })).toBe("Tous les mois, le 5");
    expect(say(fr, "fr", { dayOfMonth: 21 })).toBe("Tous les mois, le 21");
    expect(say(fr, "fr", { interval: 2, dayOfMonth: 5 })).toBe(
      "Tous les 2 mois, le 5",
    );
  });

  it("says the other rules", () => {
    expect(say(fr, "fr", { frequency: "daily" })).toBe("Tous les jours");
    expect(say(fr, "fr", { frequency: "weekly", weekday: 1 })).toBe(
      "Toutes les semaines, le lundi",
    );
    expect(
      say(fr, "fr", { weekOfMonth: 2, weekday: 2, dayOfMonth: null }),
    ).toBe("Tous les mois, le deuxième mardi");
    expect(say(fr, "fr", { frequency: "yearly", dayOfMonth: 15 })).toBe(
      "Tous les ans, le 15 octobre",
    );
  });
});
