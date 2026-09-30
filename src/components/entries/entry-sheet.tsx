import { Skeleton } from "@/components/ui/skeleton";

/**
 * The entry drawer's shell, apart from the form that fills it.
 *
 * Three things open the add-entry form in a drawer — the routed drawer, the
 * local one the bottom bar opens with no network, and the offline screen —
 * and all three want to look like one drawer. What they share lives here
 * rather than beside the form, because a module that imports the form imports
 * all of it: the receipt scanner, the category sheets, the split sheet. The
 * offline drawer is mounted on every group screen and only opens the form
 * after a tap, so it must be able to draw the drawer without pulling the form
 * in behind it.
 *
 * No `"use client"` either, and on purpose: the drawer's loading boundary is a
 * Server Component, and a constant read through a client module arrives there
 * as a client reference rather than as the string — `cn()` drops it without a
 * word, and the skeleton rendered with no height, no corners and no ground.
 */

/**
 * The drawer's own geometry, shared by every shell that opens the form.
 *
 * The routed drawer (`add-entry-drawer.tsx`) and the local one that opens with
 * no network (`components/offline/offline-entry.tsx`) are different shells for
 * good reasons, but they are visibly the same drawer, and a reader who loses
 * signal mid-trip should not watch it change shape. The notes below are why
 * each part of it is what it is.
 *
 * The sheet is the scroll container the swipe-to-dismiss gesture reads, so the
 * body scrolls inside it and the chrome stays put.
 *
 * The *page* surface rather than the card one, which is what leaves the row
 * cards inside somewhere to sit. On `bg-card` they were white on white in the
 * light theme, with only their internal hairlines to say where one card ended
 * and the next began.
 *
 * The 28px gap is measured from the bottom of the safe area, not from the top
 * of the screen: `viewport-fit=cover` means `100dvh` runs the full height of
 * the display, so installed on a phone with an island the header — and the
 * close button in it — sat underneath.
 *
 * The `max-h` says the same thing a second time, in older words. A height is
 * one declaration, and a browser that cannot parse any part of it drops the
 * whole thing and leaves the sheet at its content's height — which is how the
 * close button left the screen twice. The backstop is built from `%` and
 * `calc` alone, so it survives losing the two newest pieces, `dvh` and `min()`.
 * It never binds while the height applies: `100%` of a fixed element is the
 * large viewport, so it can only ever be the looser of the two.
 */
export const ENTRY_SHEET_CLASS =
  "h-[min(800px,calc(100dvh-28px-env(safe-area-inset-top)))] max-h-[calc(100%-28px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[24px] bg-background p-0 text-foreground";

/**
 * Open on the amount, because that is the field every entry starts with.
 *
 * Left alone, the focus scope takes the first tabbable thing in the drawer,
 * which is the close button — so recording an expense, the most repeated
 * action in the app, began with a tap that entered nothing.
 *
 * Only when the field is empty. A drawer opened to edit an entry, or opened
 * from a stated debt with the outstanding figure already in it, is not one the
 * reader came to type a number into; those keep the default, which puts focus
 * at the top of the drawer.
 *
 * `preventDefault` is how Radix is told the scope should not place focus
 * itself. Note that iOS only raises the keyboard for focus it can attribute to
 * a gesture, and a drawer that arrives with a route transition has spent that:
 * there the caret lands and the keyboard may still wait for the first tap.
 * Desktop and Android open ready to type, and neither platform is worse off
 * than it was.
 *
 * Kept beside the geometry above, and for the same reason: the offline drawer
 * opens this same form, and a drawer that put the caret somewhere else the
 * moment the signal went would be a different drawer wearing the routed one's
 * clothes.
 */
export function openOnAmount(event: Event): void {
  /*
   * Narrowed rather than asserted. Radix raises this one itself, from the
   * focus scope rather than from the DOM, so `currentTarget` is typed
   * `EventTarget | null` and carries no `querySelector` — and a cast here
   * would be a promise about a value this file does not own. `openOnContent`
   * in `components/ui/sheet.tsx` guards the same way, and every other sheet in
   * the app goes through it.
   *
   * Failing the guard returns without preventing the default, so focus lands
   * where the scope would have put it: the behaviour of a drawer that never
   * asked for anything else.
   */
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const amount = event.currentTarget.querySelector<HTMLInputElement>(
    "input[data-entry-amount]",
  );
  if (!amount || amount.value !== "") return;
  event.preventDefault();
  amount.focus({ preventScroll: true });
}

/**
 * The form before it has arrived: the three things at the top of it, in their
 * own proportions — the tab row, the amount card, and the description block
 * under it.
 *
 * Shown by the routed drawer's loading boundary while the server answers, and
 * by the offline drawer while the form's code is read from the device.
 */
export function EntryFormSkeleton() {
  return (
    <>
      <Skeleton className="h-10 w-full rounded-full" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-28 w-full rounded-2xl" />
    </>
  );
}
