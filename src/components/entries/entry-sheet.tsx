import type { ComponentProps } from "react";
import type { DialogSize } from "@/components/ui/dialog-size";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
 *
 * From `md` up it is held to a phone's width and centred, as every bottom
 * sheet is (see `SheetContent`). Said here as well because the drawer's
 * loading boundary is not a `SheetContent` — it borrows this class and pins
 * itself — and a skeleton the width of the window that became a 28rem drawer
 * when the form arrived would be the drawer changing shape under the reader.
 *
 * From `lg` up it is not a drawer at all but a dialog over the screen, 720px
 * wide and 880px from `xl`: every shell passes `desk={ENTRY_DESK}` to its
 * `SheetContent`, and the loading boundary adds `deskDialogClass` to this. The
 * screen behind it stays where it was, as it does under the drawer. Its
 * height there is what the form holds rather than most of the window — a
 * repayment is half the height of an expense with its split laid out — up to
 * the cap the dialog geometry sets, past which the form's body scrolls.
 */
export const ENTRY_SHEET_CLASS =
  "h-[min(800px,calc(100dvh-28px-env(safe-area-inset-top)))] max-h-[calc(100%-28px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[24px] bg-background p-0 text-foreground md:mx-auto md:max-w-md lg:h-auto";

/** The entry dialog's width on a desk: see `dialog-size.ts`. */
export const ENTRY_DESK = "lg" satisfies DialogSize;

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
 * The scrolling middle of a sheet raised over the form that has a button to
 * press — who paid and how it splits, a pair named by hand, a schedule.
 *
 * Those sheets used to scroll as one piece, button included, so the button was
 * the last thing in them and the first thing a phone lost: below the edge on a
 * tall split, under the keyboard the moment an exact amount was typed. Now the
 * body scrolls and the button is pinned under it in `PinnedActions`, the same
 * shape the drawer itself takes.
 *
 * It runs to the sheet's edges and pads itself back in, so the focus ring on a
 * control at the side is not clipped by the scroll. The padding at its foot is
 * what lets the last row clear the hairline when scrolled to the end.
 *
 * The caller's root has to be `flex min-h-0 flex-col`, or nothing gives way
 * when the sheet reaches its height limit and the body never scrolls at all.
 */
export function PinnedBody({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn(
        "-mx-4 flex min-h-0 flex-col gap-4 overflow-y-auto px-4 pb-4 [&>*]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The foot of such a sheet: its button, never scrolled away from.
 *
 * Beside the body rather than over it, so it covers no row. A hairline across
 * the full width says where the body is cut off, as the drawer's own footer
 * does. The room under it is the sheet's: the sheet clears the home indicator,
 * and stops clearing it while it rides on the keyboard.
 */
export function PinnedActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-actions"
      className={cn(
        "-mx-4 flex shrink-0 flex-col gap-2 border-t border-border px-4 pt-3",
        className,
      )}
      {...props}
    />
  );
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
