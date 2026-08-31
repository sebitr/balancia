"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { listQuery, withQuery } from "@/components/expenses/list-query";
import { AddEntryForm, type AddEntryFormProps } from "./add-entry-form";
import { draftFields, type EntryDraftFields } from "./draft-fields";
import { loadDraft } from "@/lib/offline/drafts";

/**
 * What the draft row adds to the URL to say "put it back".
 *
 * A parameter rather than a route: it is the same drawer either way, and a
 * second route would be a second place for the form to be constructed.
 */
export const RESUME_PARAM = "draft";

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
 * A route change that still has somewhere to go back to waits for it. Popping
 * the route the moment the drawer is dismissed would unmount it mid-animation,
 * and the drawer would vanish rather than slide away. An entry that is gone is
 * the exception, and the reason is below.
 */
const EXIT_MS = 380;

/**
 * The drawer's own geometry, shared with the offline drawer.
 *
 * Two components open this same form — this one on a route, and the local one
 * that opens with no network (`components/offline/offline-entry.tsx`). They are
 * different shells for good reasons, but they are visibly the same drawer, and
 * a reader who loses signal mid-trip should not watch it change shape. The
 * notes below are why each part of it is what it is.
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
 * Hoisted beside the geometry above, and for the same reason: the offline
 * drawer opens this same form, and a drawer that put the caret somewhere else
 * the moment the signal went would be a different drawer wearing this one's
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
 * Why the drawer is leaving, and where that leaves the reader.
 *
 * One value rather than a flag and a destination beside it, so a departure
 * cannot be half-described: an entry that has gone always knows where the
 * reader should be instead, whether that is the screen it moved to or the
 * group it was removed from.
 */
type Exit =
  | { readonly kind: "dismiss" }
  | { readonly kind: "saved" }
  | { readonly kind: "gone"; readonly to: string };

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
  /*
   * The filters of the list the reader came from, which this route was opened
   * carrying and which the screen it hands them on to must carry too.
   *
   * The drawer is the one that knows them. The form below builds a path to a
   * row in another table — an id it has just been given — and has no business
   * knowing which list somebody was reading when they opened it.
   */
  const searchParams = useSearchParams();
  const [exit, setExit] = useState<Exit | null>(null);

  useEffect(() => {
    if (exit === null) return;

    const leave = () => {
      // `gone` overrides `dismissTo` on purpose. Back is only ever a way out
      // while what is behind still exists, and an entry that was deleted — or
      // moved to the other table by a change of type — takes its detail screen
      // with it. Popping onto it would land the reader on a 404.
      //
      // It replaces rather than pushes, too. This URL edits an entry that is
      // no longer there, so it is not a place to return to: leaving it in the
      // stack only puts a removed entry between the reader and the screen they
      // were actually browsing.
      if (exit.kind === "gone") {
        router.replace(exit.to);
      } else if (dismissTo === "back") {
        router.back();
      } else {
        router.push(`/groups/${form.groupId}`);
      }
      // After the navigation, not before it: what is now stale is the group
      // behind, and refreshing while still on `/expenses/new` would only
      // refetch the drawer's own route.
      if (exit.kind !== "dismiss") router.refresh();
    };

    // An entry that is gone cannot wait for the animation.
    //
    // Every Server Action re-renders the page it was called from, and the page
    // this one was called from is `/expenses/<id>/edit`, whose whole job is to
    // load the entry that has just been removed. That re-render is already on
    // its way back when the action resolves, so a departure held for the
    // slide-out arrives after it: the route answers 404, the reader lands on
    // the not-found screen, and the only way on from there is the homepage.
    //
    // Leaving in the same turn wins that race by construction rather than by
    // luck. A navigation dispatched while a Server Action is still in flight
    // marks it discarded, so its state is never applied, and Next re-runs the
    // revalidation it asked for once the navigation has landed. What it costs
    // is the slide-out — which had nothing to slide back onto.
    if (exit.kind === "gone") {
      leave();
      return;
    }

    const timer = setTimeout(leave, EXIT_MS);
    return () => clearTimeout(timer);
  }, [exit, dismissTo, form.groupId, router]);

  /*
   * The group's half-written entry, read before the form mounts.
   *
   * The form seeds its fields from it, so it has to be in hand by the first
   * render rather than applied a frame later — a drawer that appears empty
   * and then fills itself reads as two screens. `undefined` is "still
   * looking", and the drawer holds its body back for that one IndexedDB get.
   *
   * Only when the reader asked to resume, which is what the draft row on the
   * group screen links to. Every other way in renders immediately: waiting on
   * storage before showing a form nobody asked to restore would make the
   * ordinary case pay for the rare one.
   */
  const resuming = searchParams.get(RESUME_PARAM) === "1" && !form.editing;
  const [draft, setDraft] = useState<EntryDraftFields | null | undefined>(
    resuming ? undefined : null,
  );
  const memberKey = form.members.map((member) => member.id).join(",");
  useEffect(() => {
    if (!resuming) return;
    let cancelled = false;
    void loadDraft(form.groupId).then((stored) => {
      if (cancelled) return;
      setDraft(
        stored ? draftFields(stored.fields, memberKey.split(",")) : null,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [resuming, form.groupId, memberKey]);

  return (
    <Sheet
      open={exit === null}
      onOpenChange={(open) => !open && setExit({ kind: "dismiss" })}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className={ENTRY_SHEET_CLASS}
        onOpenAutoFocus={openOnAmount}
      >
        {draft !== undefined && (
          <AddEntryForm
            {...form}
            draft={draft}
            onClose={() => setExit({ kind: "dismiss" })}
            // A saved entry leaves the same way a dismissed one does — the
            // confirmation is a toast, which outlives the drawer.
            onSaved={() => setExit({ kind: "saved" })}
            // A conversion knows the screen the entry moved to and that is where
            // the reader goes; a deletion has no such screen, and the group is
            // the nearest thing to where the entry used to be.
            //
            // The filters go with it. Changing an expense into a repayment moves
            // the entry to another table and so to another detail screen, and
            // that screen is where the reader presses Back — onto a list which,
            // without this, had forgotten what it was showing and where in it
            // they were. A deletion goes to the group instead, which is not a
            // list and has no filters to keep.
            onRemoved={(to) =>
              setExit({
                kind: "gone",
                to: to
                  ? withQuery(to, listQuery(searchParams))
                  : `/groups/${form.groupId}`,
              })
            }
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
