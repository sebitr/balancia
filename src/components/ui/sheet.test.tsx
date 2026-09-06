import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  LAYOUT_HEIGHT,
  fakeViewport,
  releaseViewport,
} from "../../../tests/helpers/viewport";
import { Sheet, SheetContent, SheetTitle } from "./sheet";

/**
 * That a bottom sheet gets out from under the keyboard.
 *
 * This is the one thing about the sheet that cannot be seen in a desktop
 * browser: there is no soft keyboard there, so `visualViewport` never shrinks
 * and the interesting branch never runs. So the viewport is faked, which is
 * also the only way to assert the arithmetic — a phone can show the bug but
 * cannot tell you the sheet moved by exactly the right number of pixels.
 */

afterEach(releaseViewport);

function renderSheet() {
  render(
    <Sheet open>
      <SheetContent side="bottom" className="max-h-[86vh]">
        <SheetTitle>Currency</SheetTitle>
      </SheetContent>
    </Sheet>,
  );
  return screen.getByRole("dialog");
}

describe("a bottom sheet with the keyboard open", () => {
  it("sits on top of the keyboard instead of behind it", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    const sheet = renderSheet();

    expect(sheet.style.bottom).toBe("");

    viewport.keyboard(336);

    expect(sheet.style.bottom).toBe("336px");
    // And gives up the height it just moved through, or the top of the sheet
    // would leave the screen in exchange for the bottom arriving.
    expect(sheet.style.maxHeight).toBe("calc(100dvh - 352px)");
  });

  it("drops back to the bottom edge when the keyboard goes away", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    const sheet = renderSheet();

    viewport.keyboard(336);
    viewport.keyboard(0);

    expect(sheet.style.bottom).toBe("");
    expect(sheet.style.maxHeight).toBe("");
  });

  /**
   * iOS scrolls the visual viewport within the layout one to keep the focused
   * field in sight. That part of the gap is not keyboard, and counting it
   * would push the sheet up past the keyboard by however far the page moved.
   */
  it("does not count a scrolled visual viewport as more keyboard", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    const sheet = renderSheet();

    viewport.offsetTop = 120;
    viewport.keyboard(336);

    expect(sheet.style.bottom).toBe("216px");
  });

  /**
   * The two viewports disagree by a few pixels as browser chrome collapses.
   * Reading that as a keyboard would leave every sheet floating slightly off
   * the bottom edge for no reason.
   */
  it("ignores a gap too small to be a keyboard", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    const sheet = renderSheet();

    viewport.keyboard(44);

    expect(sheet.style.bottom).toBe("");
  });

  /** A side sheet is not anchored to the edge the keyboard comes from. */
  it("leaves a side sheet alone", () => {
    const viewport = fakeViewport(LAYOUT_HEIGHT);
    render(
      <Sheet open>
        <SheetContent side="right">
          <SheetTitle>Filters</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    viewport.keyboard(336);

    expect(screen.getByRole("dialog").style.bottom).toBe("");
  });
});

/**
 * Pushing a sheet away, and not pushing it away by accident.
 *
 * The interesting case is the tall sheet, which keeps its header and footer
 * fixed and scrolls a body inside instead. Its own `scrollTop` is 0 whatever
 * the body is doing, so a gesture that consulted only the sheet armed itself
 * on every touch — and the body could then be scrolled down but never back up,
 * because the swipe that would scroll it up dismissed the sheet instead.
 */
describe("pushing a bottom sheet away", () => {
  function renderTallSheet() {
    render(
      <Sheet open>
        {/* The shape the add-entry drawer and the group sheet both take. */}
        <SheetContent side="bottom" className="overflow-hidden">
          <SheetTitle>Add expense</SheetTitle>
          <div data-testid="body" className="overflow-y-auto">
            <p data-testid="row">A row some way down the list</p>
          </div>
        </SheetContent>
      </Sheet>,
    );
    return {
      sheet: screen.getByRole("dialog"),
      body: screen.getByTestId("body"),
      row: screen.getByTestId("row"),
    };
  }

  /** jsdom ships no `PointerEvent`, and only four of its fields are read. */
  function touch(target: Element, type: string, clientY: number) {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 1,
      clientY,
    });
    target.dispatchEvent(event);
  }

  /**
   * Also the guard on the binding itself. The gesture used to read the sheet
   * from a ref on a commit where Radix's portal had not rendered the content
   * yet, so the listeners went nowhere and this moved nothing.
   */
  it("follows a downward drag that starts at the top of the body", () => {
    const { sheet, row } = renderTallSheet();

    touch(row, "pointerdown", 100);
    touch(row, "pointermove", 140);

    expect(sheet.style.transform).toBe("translate3d(0, 40px, 0)");
  });

  /** The regression: the body scrolls, and the sheet stays where it is. */
  it("leaves a scrolled body to scroll itself back up", () => {
    const { sheet, body, row } = renderTallSheet();
    body.scrollTop = 120;

    touch(row, "pointerdown", 100);
    touch(row, "pointermove", 140);

    expect(sheet.style.transform).toBe("");
  });

  it("does not lift the sheet off the bottom edge on an upward swipe", () => {
    const { sheet, row } = renderTallSheet();

    touch(row, "pointerdown", 100);
    touch(row, "pointermove", 60);

    expect(sheet.style.transform).toBe("");
  });
});

/**
 * The short sheets — currency, category, the payment methods — scroll their
 * own content rather than a body inside, and must keep doing so.
 */
describe("a sheet that scrolls itself", () => {
  it("reads its own scroll position", () => {
    render(
      <Sheet open>
        <SheetContent side="bottom" className="overflow-y-auto">
          <SheetTitle>Currency</SheetTitle>
          <p data-testid="row">CHF</p>
        </SheetContent>
      </Sheet>,
    );
    const sheet = screen.getByRole("dialog");
    const row = screen.getByTestId("row");

    const event = new Event("pointerdown", { bubbles: true, cancelable: true });
    Object.assign(event, {
      pointerType: "touch",
      isPrimary: true,
      pointerId: 1,
      clientY: 100,
    });
    sheet.scrollTop = 90;
    row.dispatchEvent(event);

    const move = new Event("pointermove", { bubbles: true, cancelable: true });
    Object.assign(move, { pointerId: 1, clientY: 140 });
    row.dispatchEvent(move);

    expect(sheet.style.transform).toBe("");
  });
});

/**
 * One grabber, drawn in one place.
 *
 * `SheetContent` puts the pill at the top of every bottom sheet itself. Two
 * call sites drew a second one directly underneath it — the position sheet and
 * the settlement detail — and the pair read as one thick smudged bar rather
 * than as a handle.
 *
 * They had a reason, which is why this is a test and not a note. The
 * primitive's grabber carries `mb-1` and gets the rest of the room under it
 * from the container's `gap-4`; a sheet that spaces its children by hand turns
 * that gap off, the pill ends up 4px from the title, and adding a grabber with
 * the margin baked in looks exactly like the fix. So the rule is enforced from
 * both ends: the primitive draws one, and no component may draw its own.
 */
/**
 * Every `<SheetContent …>` opening tag in a file, children left behind.
 *
 * A regex to the first `>` would stop inside `data-[side=bottom]:border-t-0`
 * or an arrow function, and one to the first `>` on a line of its own would
 * swallow the children of the sheets written on a single line — which is how
 * a padding on a row inside the sheet gets blamed on the sheet. So the tag is
 * scanned: quotes, `//` comments and braces are stepped over, and the `>` that
 * closes the tag is the one found outside all three.
 */
function openingTags(source: string): string[] {
  const tags: string[] = [];

  for (const match of source.matchAll(/<SheetContent\b/g)) {
    const start = match.index;
    let depth = 0;
    let quote: string | undefined;
    let i = start + match[0].length;

    for (; i < source.length; i += 1) {
      const c = source[i];
      if (quote) {
        if (c === quote) quote = undefined;
      } else if (c === "/" && source[i + 1] === "/") {
        const end = source.indexOf("\n", i);
        if (end === -1) break;
        i = end;
      } else if (c === '"' || c === "'" || c === "`") {
        quote = c;
      } else if (c === "{") {
        depth += 1;
      } else if (c === "}") {
        depth -= 1;
      } else if (c === ">" && depth === 0) {
        break;
      }
    }

    tags.push(source.slice(start, i + 1));
  }

  return tags;
}

describe("the grabber", () => {
  it("is drawn once on a bottom sheet, and not at all on a side one", () => {
    const { unmount } = render(
      <Sheet open>
        <SheetContent side="bottom">
          <SheetTitle>Your position</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    expect(
      document.querySelectorAll('[data-slot="sheet-grabber"]'),
    ).toHaveLength(1);
    unmount();

    render(
      <Sheet open>
        <SheetContent side="right">
          <SheetTitle>Filters</SheetTitle>
        </SheetContent>
      </Sheet>,
    );

    expect(
      document.querySelectorAll('[data-slot="sheet-grabber"]'),
    ).toHaveLength(0);
  });

  /**
   * The render test above cannot see a hand-rolled pill in a call site, so the
   * source is read for the shape of one: a 4px-tall element with a full
   * radius. Nothing else in the product is both.
   */
  it("is not hand-rolled anywhere else in the product", () => {
    const PILL = /className="[^"]*\bh-1\b[^"]*\brounded-full\b[^"]*"/;
    const offenders: string[] = [];

    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.name.endsWith(".tsx")) {
          const source = readFileSync(full, "utf8");
          if (source.includes("SheetContent") && PILL.test(source)) {
            offenders.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(path.join(process.cwd(), "src", "components"));

    // `ui/sheet.tsx` is where the one grabber lives. Anything else listed here
    // is a second bar under the first: delete it, and if the sheet has turned
    // off `gap-4`, state the room under the grabber on its first child.
    expect(offenders).toEqual(["src/components/ui/sheet.tsx"]);
  });

  /**
   * And the room above it is drawn in that one place too.
   *
   * Twenty-two bottom sheets each said how far from the top edge the pill
   * should sit, and gave four different answers plus silence: `pt-2.5` on
   * eleven, `pt-3.5` on the group picker, `pt-4` on the install steps, `pt-2`
   * on the notification sheet, and nothing at all on the other eight. Nothing
   * is the bad one — a 4px pill 1px under the border, inside a 24px corner
   * radius, reads as a mark on the sheet's edge rather than as a handle.
   *
   * So the grabber carries `mt-2.5` itself, and a sheet that states a top
   * padding is now adding to it rather than setting it. The padding also
   * cannot be moved into the primitive: `cn` merges the caller's last, and the
   * entry drawer's `p-0` would drop it.
   */
  it("gets its room above from the primitive, not from the sheet", () => {
    const grabber = readFileSync(
      path.join(process.cwd(), "src", "components", "ui", "sheet.tsx"),
      "utf8",
    );
    expect(grabber).toContain('className="mx-auto mt-2.5 mb-1 h-1 w-9');

    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith(".tsx")) continue;
        const source = readFileSync(full, "utf8");
        // The whole opening tag, `cn` branches and all — a padding hidden in a
        // ternary spaces the sheet just as wrongly as one spelled plainly.
        for (const tag of openingTags(source)) {
          if (/\b(?:pt|py|p)-(?!0\b)/.test(tag)) {
            offenders.push(path.relative(process.cwd(), full));
          }
        }
      }
    };
    walk(path.join(process.cwd(), "src", "components"));

    // A sheet listed here has pushed its own grabber down. Take the padding
    // off; the room above the pill is the same on every screen and comes from
    // `ui/sheet.tsx`. `p-0` is fine — it says "no padding", which is true.
    expect(offenders).toEqual([]);
  });
});
