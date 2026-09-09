import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GROUP_ICON_GLYPHS } from "@/components/groups/group-icon";
import { GROUP_ICONS } from "./icons";
import { GLYPH_VIEWBOX, SHARE_CARD_GLYPHS } from "./share-card-glyphs";

/**
 * The share card's glyphs against the ones the app draws.
 *
 * The card cannot use `lucide-react` — satori calls a component with no React
 * behind it, and every lucide icon reads a context — so the geometry is
 * copied into `share-card-glyphs.ts`. This is what stops the copy drifting:
 * each icon is rendered through the component the product uses, and compared
 * shape by shape and attribute by attribute with the entry beside it.
 *
 * So a lucide upgrade that redraws an icon fails here, naming it, rather than
 * leaving one group's chat bubble showing last year's suitcase.
 */

/** What the component actually put in the document, as the card would list it. */
function shapesOf(element: SVGElement) {
  return [...element.children].map((child) => [
    child.tagName.toLowerCase(),
    Object.fromEntries(
      [...child.attributes].map((attribute) => [
        attribute.name,
        attribute.value,
      ]),
    ),
  ]);
}

describe("the glyphs the share card draws", () => {
  it.each(GROUP_ICONS)("draws %s the way lucide does", (icon) => {
    const Icon = GROUP_ICON_GLYPHS[icon];
    const { container } = render(<Icon />);
    const svg = container.querySelector("svg");
    if (!svg) throw new Error(`${icon} rendered no svg`);

    expect(shapesOf(svg)).toEqual(
      SHARE_CARD_GLYPHS[icon].map(([tag, attributes]) => [tag, attributes]),
    );
    expect(svg.getAttribute("viewBox")).toBe(GLYPH_VIEWBOX);
  });
});
