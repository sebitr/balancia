import { describe, expect, it } from "vitest";
import { IntlMessageFormat } from "intl-messageformat";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import {
  savedSeriesMessage,
  updatedSeriesMessage,
  type SavedSeries,
  type UpdatedSeries,
} from "./saved-series";

/**
 * The sentence a saved series is confirmed with, which has to be true.
 *
 * Rendered against the shipped catalogues rather than checked as keys, because
 * the failure this replaces was a sentence — "Recurring entry saved", with no
 * expense to show for it — and each case is one whole message whose plural
 * has to come out right in both languages.
 */

/** Stands in for the reader's date format; what matters is where it lands. */
const day = (date: string) => `<${date}>`;

function say(
  locale: "en" | "fr",
  series: SavedSeries | undefined,
  description = "Internet",
): string {
  const message = savedSeriesMessage(series, description, day);
  const catalogue = (locale === "en" ? en : fr).recurring.saved;
  return new IntlMessageFormat(catalogue[message.key], locale).format(
    message.values,
  ) as string;
}

describe("savedSeriesMessage", () => {
  it("says the expense was added, and when the next one comes", () => {
    const series = { added: 1, addedFrom: "2026-10-05", next: "2026-11-05" };

    expect(savedSeriesMessage(series, "Internet", day).key).toBe("added");
    expect(say("en", series)).toBe(
      "Internet added. The next one is on <2026-11-05>.",
    );
    expect(say("fr", series)).toBe(
      "« Internet » a été ajouté. Prochaine occurrence le <2026-11-05>.",
    );
  });

  /** A start in the past is caught up, and the reader is told how far back. */
  it("says how many were added, and from when, when there were several", () => {
    const series = { added: 3, addedFrom: "2026-08-05", next: "2026-11-05" };

    expect(say("en", series)).toBe(
      "Internet added 3 times, from <2026-08-05>. The next one is on <2026-11-05>.",
    );
    expect(say("fr", series)).toBe(
      "« Internet » a été ajouté 3 fois, depuis le <2026-08-05>. Prochaine occurrence le <2026-11-05>.",
    );
  });

  it("does not promise a next one when that was the last", () => {
    const series = { added: 1, addedFrom: "2026-10-05", next: null };

    expect(savedSeriesMessage(series, "Internet", day).key).toBe("addedLast");
    expect(say("en", series)).toBe("Internet added. That was the last one.");
    expect(say("fr", series)).toBe(
      "« Internet » a été ajouté. Il n’y en aura pas d’autre.",
    );
  });

  it("says when the first one will come, when it has not yet", () => {
    const series = { added: 0, addedFrom: null, next: "2026-11-05" };

    expect(savedSeriesMessage(series, "Internet", day).key).toBe("firstOn");
    expect(say("en", series)).toBe(
      "Internet saved. The first one will be added on <2026-11-05>.",
    );
    expect(say("fr", series)).toBe(
      "« Internet » est enregistré. La première occurrence sera ajoutée le <2026-11-05>.",
    );
  });

  /**
   * Nothing added and no date to name — a series that ends before its first
   * date, or an answer with no series in it — claims only that it was saved.
   */
  it("claims no more than that it was saved when there is nothing to say", () => {
    const empty = { added: 0, addedFrom: null, next: null };

    expect(say("en", empty)).toBe("Internet saved.");
    expect(say("en", undefined)).toBe("Internet saved.");
    expect(say("fr", empty)).toBe("« Internet » est enregistré.");
  });
});

/**
 * The sentence a changed series is confirmed with. Each one ends by saying the
 * entries already added are untouched, which is what an edit to a rule makes
 * somebody wonder, and what the button that saved it promised.
 */
describe("updatedSeriesMessage", () => {
  function sayUpdated(
    locale: "en" | "fr",
    updated: UpdatedSeries | undefined,
  ): string {
    const message = updatedSeriesMessage(updated, "Rent", day);
    const catalogue = (locale === "en" ? en : fr).recurring.updated;
    return new IntlMessageFormat(catalogue[message.key], locale).format(
      message.values,
    ) as string;
  }

  it("says from when the change applies", () => {
    const updated = { next: "2026-11-01", paused: false };

    expect(sayUpdated("en", updated)).toBe(
      "Rent updated from <2026-11-01>. Entries already added stay as they were.",
    );
    expect(sayUpdated("fr", updated)).toContain("à partir du <2026-11-01>");
  });

  it("says a paused series is still paused, whatever its marker says", () => {
    expect(sayUpdated("en", { next: "2026-11-01", paused: true })).toBe(
      "Rent updated, and still paused. Entries already added stay as they were.",
    );
  });

  it("says a series with nothing left in it has no dates left", () => {
    expect(sayUpdated("en", { next: null, paused: false })).toBe(
      "Rent updated. It has no dates left; entries already added stay as they were.",
    );
    expect(sayUpdated("en", undefined)).toMatch(/^Rent updated\./);
  });
});
