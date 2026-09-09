import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A closed overlay never takes a click.
 *
 * Radix keeps an overlay mounted while it plays the exit animation and
 * unmounts it when the animation ends. An overlay nested inside an open sheet
 * has been seen to miss that event and stay mounted for good — `data-state`
 * reading "closed", still `fixed inset-0`, still swallowing everything.
 *
 * Ten percent black over a sheet that is already dimmed looks like nothing at
 * all, so the reader does not get a covered screen, they get a dead one. That
 * is what "dictate works once and then the form stops responding" was: the
 * consent dialog was answered, its scrim stayed, and every press after it
 * landed on a scrim nobody could see. Only a reload cleared it.
 *
 * So the closed state is inert, in all three, and this is the test that says
 * so — the class is one token in a long string and it is exactly the kind of
 * thing a later tidy-up drops.
 */

const OVERLAYS = [
  ["alert-dialog.tsx", "AlertDialogOverlay"],
  ["dialog.tsx", "DialogOverlay"],
  ["sheet.tsx", "SheetOverlay"],
] as const;

describe("every dialog scrim", () => {
  it.each(OVERLAYS)("is inert once closed in %s", (file, component) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    const start = source.indexOf(`function ${component}(`);
    expect(start, `${component} not found in ${file}`).toBeGreaterThan(-1);
    // The component body, up to the next declaration at the left margin.
    const end = source.indexOf("\n}\n", start);
    const body = source.slice(start, end);

    expect(body).toContain("fixed inset-0");
    expect(body).toContain("data-closed:pointer-events-none!");
  });
});
