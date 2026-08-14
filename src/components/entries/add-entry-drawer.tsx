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
   * Where dismissal leads.
   *
   * `back` pops the intercepted route, returning to whatever the drawer opened
   * over. `group` is for the standalone route, arrived at by a link or a
   * refresh, where there is no such thing behind to go back to.
   */
  dismissTo: "back" | "group";
}) {
  const router = useRouter();
  const [exit, setExit] = useState<null | "dismiss" | "group">(null);

  useEffect(() => {
    if (exit === null) return;
    const timer = setTimeout(() => {
      if (exit === "dismiss" && dismissTo === "back") {
        router.back();
        return;
      }
      router.push(`/groups/${form.groupId}`);
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
        className="h-[min(800px,calc(100dvh-28px))] gap-0 overflow-hidden rounded-t-[24px] bg-background p-0 text-foreground"
      >
        <AddEntryForm
          {...form}
          onClose={() => setExit("dismiss")}
          // "Back to group" means the group, even when the drawer was opened
          // from somewhere else in it and `back` would land on that instead.
          onBackToGroup={() => setExit("group")}
        />
      </SheetContent>
    </Sheet>
  );
}
