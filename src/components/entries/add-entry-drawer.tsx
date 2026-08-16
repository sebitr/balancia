"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { AddEntryForm, type AddEntryFormProps } from "./add-entry-form";

/**
 * The add-entry screen, as a drawer over the group it belongs to.
 *
 * Adding an expense is something you do *to* a group, not a place you go, and
 * a full-height drawer says so: the group stays on screen behind it, dimmed,
 * and dismissing gets you back to exactly what you were looking at. It also
 * removes the two pieces of furniture a route came with — the app header and
 * the tab bar — neither of which has anything to offer while a form is open.
 *
 * The drawer stops short of the top edge rather than filling the screen. That
 * strip of group showing above it is what makes it read as a layer that can be
 * pushed away, and the swipe that pushes it away is the sheet's own.
 */

/**
 * How long the sheet takes to leave, matching `SheetContent`'s own exit.
 *
 * The route change waits for it. Popping the route the moment the drawer is
 * dismissed would unmount it mid-animation, and the drawer would vanish rather
 * than slide away.
 */
const EXIT_MS = 380;

export function AddEntryDrawer({
  dismissTo,
  ...form
}: AddEntryFormProps & {
  /**
   * Where leaving leads — saved or dismissed, it is the same way out.
   *
   * `back` pops the intercepted route, returning to whatever the drawer opened
   * over. `group` is for the standalone route, arrived at by a link or a
   * refresh, where there is no such thing behind to go back to.
   *
   * Saving used to push `/groups/<id>` instead of popping, on the grounds that
   * "back to group" should mean the group. It left `/expenses/new` sitting in
   * the history behind it, so the next back gesture — which on a phone is how
   * you leave anything — reopened the form over the group.
   */
  dismissTo: "back" | "group";
}) {
  const router = useRouter();
  const [exit, setExit] = useState<null | "dismiss" | "saved">(null);

  useEffect(() => {
    if (exit === null) return;
    const timer = setTimeout(() => {
      if (dismissTo === "back") {
        router.back();
      } else {
        router.push(`/groups/${form.groupId}`);
      }
      // After the navigation, not before it: what is now stale is the group
      // behind, and refreshing while still on `/expenses/new` would only
      // refetch the drawer's own route.
      if (exit === "saved") router.refresh();
    }, EXIT_MS);
    return () => clearTimeout(timer);
  }, [exit, dismissTo, form.groupId, router]);

  return (
    <Sheet
      open={exit === null}
      onOpenChange={(open) => !open && setExit("dismiss")}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        // The sheet is the scroll container the swipe-to-dismiss gesture reads,
        // so the body scrolls inside it and the chrome stays put.
        //
        // The *page* surface rather than the card one, which is what leaves the
        // row cards inside somewhere to sit. On `bg-card` they were white on
        // white in the light theme, with only their internal hairlines to say
        // where one card ended and the next began.
        //
        // The 28px gap is measured from the bottom of the safe area, not from
        // the top of the screen: `viewport-fit=cover` means `100dvh` runs the
        // full height of the display, so installed on a phone with an island
        // the header — and the close button in it — sat underneath.
        //
        // The `max-h` says the same thing a second time, in older words. A
        // height is one declaration, and a browser that cannot parse any part
        // of it drops the whole thing and leaves the sheet at its content's
        // height — which is how the close button left the screen twice. The
        // backstop is built from `%` and `calc` alone, so it survives losing
        // the two newest pieces, `dvh` and `min()`. It never binds while the
        // height applies: `100%` of a fixed element is the large viewport, so
        // it can only ever be the looser of the two.
        className="h-[min(800px,calc(100dvh-28px-env(safe-area-inset-top)))] max-h-[calc(100%-28px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[24px] bg-background p-0 text-foreground"
      >
        <AddEntryForm
          {...form}
          onClose={() => setExit("dismiss")}
          // A saved entry leaves the same way a dismissed one does — the
          // confirmation is a toast, which outlives the drawer.
          onSaved={() => setExit("saved")}
        />
      </SheetContent>
    </Sheet>
  );
}
