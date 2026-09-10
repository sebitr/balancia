import { describe, expect, it } from "vitest";
import {
  isFresh,
  sharedText,
  SHARE_TTL_MS,
  type SharedPayload,
} from "./shared";

/**
 * Which of the three fields a share sheet fills in is the sentence, and how
 * long a share is still the thing somebody meant.
 *
 * Sharing apps disagree about where they put the message, and the one rule
 * that has to hold across all of them is that a URL is never read as one: run
 * an address through the entry parser and the digits in its path become an
 * amount nobody spent, filed under a description of a web address.
 */

function payload(fields: Partial<SharedPayload> = {}): SharedPayload {
  return {
    id: "incoming",
    sharedAt: 0,
    title: "",
    text: "",
    url: "",
    file: null,
    ...fields,
  };
}

describe("sharedText", () => {
  it("takes the message a chat app shares", () => {
    expect(sharedText(payload({ text: "dinner was 84.20" }))).toBe(
      "dinner was 84.20",
    );
  });

  it("falls back to the title when there is no message", () => {
    // What a browser shares: the page's title in `title`, its address in
    // `url`, and nothing in `text`.
    expect(
      sharedText(
        payload({ title: "Coop Pronto — receipt", url: "https://coop.ch/r/9" }),
      ),
    ).toBe("Coop Pronto — receipt");
  });

  it("never reads a bare URL as a sentence", () => {
    // "…/product/12345" would otherwise parse as a hundred and twenty-three
    // francs against a description of a web address.
    expect(
      sharedText(payload({ text: "https://www.migros.ch/de/product/12345" })),
    ).toBe("");
    expect(sharedText(payload({ url: "https://www.migros.ch/p/12345" }))).toBe(
      "",
    );
  });

  it("keeps a sentence that merely contains a link", () => {
    const text = "paid 24.50 here https://coop.ch/r/9";
    expect(sharedText(payload({ text }))).toBe(text);
  });

  it("prefers the message over the title when both say something", () => {
    expect(
      sharedText(payload({ text: "84.20 dinner", title: "Messages" })),
    ).toBe("84.20 dinner");
  });

  it("answers nothing when nothing was written", () => {
    expect(sharedText(payload())).toBe("");
  });
});

describe("isFresh", () => {
  it("keeps a share somebody just made", () => {
    expect(isFresh(payload({ sharedAt: 1000 }), 1000 + 60_000)).toBe(true);
  });

  it("lets one abandoned at the group picker go stale", () => {
    // A receipt with somebody's card details on it should not sit in a store
    // until next Tuesday.
    expect(isFresh(payload({ sharedAt: 0 }), SHARE_TTL_MS + 1)).toBe(false);
  });

  it("treats a clock that moved backwards as fresh", () => {
    expect(isFresh(payload({ sharedAt: 5_000 }), 0)).toBe(true);
  });
});
