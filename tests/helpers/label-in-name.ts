import { expect } from "vitest";

/**
 * Every word a control shows is in its accessible name, in the same order.
 *
 * WCAG 2.5.3, Label in Name, which axe checks in the Playwright journeys as
 * `label-content-name-mismatch`: somebody driving the page by voice says
 * what they see, so a control named by `aria-label` has to contain its
 * visible words. Checked here the way axe checks it, against the element's
 * text — which includes text under `aria-hidden`, since hiding from a screen
 * reader does not hide from an eye — and with punctuation dropped, so the
 * name's commas are pauses rather than words.
 *
 * The name is the caller's, the one the control was just found by: jsdom
 * has no accessibility tree to ask.
 */
export function expectLabelInName(element: Element, name: string): void {
  const shown = words(element.textContent ?? "");
  const named = words(name);
  const found = named.some((_, start) =>
    shown.every((word, offset) => named[start + offset] === word),
  );
  expect(
    found,
    `"${element.textContent}" is not inside its name, "${name}"`,
  ).toBe(true);
}

function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}
