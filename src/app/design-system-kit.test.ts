import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The design-system kit says the same tokens as the app, and says them the
 * same way.
 *
 * `design-system/src/kit.css` opens by promising that "every value here is
 * transcribed from the running app", and nothing has ever checked. It went
 * stale the way a hand copy always does: it could only ever render coral, and
 * it was missing the tokens added after whoever last synced it.
 *
 * The rule enforced here is narrow on purpose. The kit is allowed to declare
 * *fewer* tokens than the app — it has no group accents, no marketing surfaces
 * and no scrim, because it draws none of those — and it is allowed to inline
 * the radius and shadow scale the app computes in `@theme`. What it may not do
 * is give a token a different value from the one `globals.css` gives it in the
 * same block. That is the failure mode: a swatch in the kit that is not the
 * colour the app paints.
 */

const root = new URL("../../", import.meta.url);
const APP = readFileSync(new URL("src/app/globals.css", root), "utf8");
const KIT = readFileSync(new URL("design-system/src/kit.css", root), "utf8");

/** The blocks that exist in both files, by the selector each is written with. */
const SHARED_BLOCKS = [":root", ".dark", '.dark[data-dark="midnight"]'];

/**
 * Every `--token: value;` inside one selector's block.
 *
 * Braces are counted rather than scanning for the next `}` in column zero:
 * the contrast blocks sit inside `@media (prefers-contrast: more)`, so theirs
 * are indented. Matching the opening at the start of a line also keeps
 * `.dark {` from being found inside `:root.dark {`.
 */
function tokens(css: string, selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opening = new RegExp(`^[ \\t]*${escaped} \\{`, "m").exec(css);
  if (!opening) throw new Error(`no ${selector} block`);
  let depth = 0;
  let end = opening.index;
  for (let i = opening.index; i < css.length; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const found = new Map<string, string>();
  for (const [, name, value] of css
    .slice(opening.index, end)
    .matchAll(/^\s*--([a-z0-9-]+):\s*([^;]+);/gim)) {
    if (!found.has(name)) found.set(name, value!.trim());
  }
  return found;
}

describe("the design-system kit", () => {
  it.each(SHARED_BLOCKS)("gives %s the values the app gives it", (selector) => {
    const app = tokens(APP, selector);
    const kit = tokens(KIT, selector);
    /**
     * The kit is the document nobody painted, so it writes flat values where
     * the app writes a `var()`: an alias resolves to the token it points at,
     * and an accent-aware token resolves to its fallback — which is the
     * palette as drawn, which is what the kit is showing.
     */
    const asDrawn = (
      block: Map<string, string>,
      value: string | undefined,
    ): string | undefined => {
      if (value === undefined) return undefined;
      const alias = value.match(/^var\(--([a-z0-9-]+)\)$/i);
      if (alias) return asDrawn(block, block.get(alias[1]!));
      const fallback = value.match(/^var\(--[a-z0-9-]+,\s*(.+)\)$/i);
      return fallback ? fallback[1]!.trim() : value;
    };

    const drifted: string[] = [];
    for (const [name, value] of kit) {
      // A token the app does not declare here is the kit's own — the radius
      // and shadow scale it inlines from `@theme`.
      const mine = asDrawn(app, app.get(name));
      if (mine === undefined) continue;
      const theirs = asDrawn(kit, value);
      if (mine !== theirs) {
        drifted.push(`--${name}: kit ${theirs}, app ${mine}`);
      }
    }
    expect(drifted).toEqual([]);
  });

  it("carries the money colours, so its swatches are the app's", () => {
    for (const selector of [":root", ".dark"]) {
      const kit = tokens(KIT, selector);
      for (const name of [
        "positive",
        "negative",
        "payer",
        "destructive",
        "positive-ink",
        "negative-ink",
        "payer-ink",
        "destructive-ink",
      ]) {
        expect(kit.has(name), `${selector} is missing --${name}`).toBe(true);
      }
    }
  });

  it("draws no surface the app no longer has", () => {
    expect(KIT).not.toContain("data-light");
    expect(KIT).not.toContain("data-contrast");
  });
});
