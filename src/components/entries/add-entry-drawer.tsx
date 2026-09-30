"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { listQuery, withQuery } from "@/components/expenses/list-query";
import { AddEntryForm, type AddEntryFormProps } from "./add-entry-form";
import { draftFields, type EntryDraftFields } from "./draft-fields";
import { RESUME_PARAM, sheetOf } from "./drawer-fragment";
import { ENTRY_SHEET_CLASS, openOnAmount } from "./entry-sheet";
import { settleIntentOf, settlePrefill } from "./settle-intent";
import { useFragmentParams } from "./use-fragment-params";
import { loadDraft } from "@/lib/offline/drafts";

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
 *
 * Whatever the link that opened it had to say — a debt to open on, a draft to
 * put back, a sheet to raise, the list to hand on to — is in the URL's
 * fragment, and this is the one component that reads it. `drawer-fragment.ts`
 * says why it is a fragment and not a query.
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
}: Omit<AddEntryFormProps, "draft" | "prefill" | "openSheet"> & {
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
   * What the link said, off the URL's fragment; null until the client has read
   * it, which only a cold load of the standalone route makes it wait for.
   *
   * Among it are the filters of the list the reader came from, which the edit
   * drawer was opened carrying and which the screen it hands them on to must
   * carry too. The drawer is the one that knows them. The form below builds a
   * path to a row in another table — an id it has just been given — and has no
   * business knowing which list somebody was reading when they opened it; and
   * the route above cannot see a fragment at all.
   */
  const params = useFragmentParams();
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
  const resuming =
    params !== null && params.get(RESUME_PARAM) === "1" && !form.editing;
  const [stored, setStored] = useState<EntryDraftFields | null | undefined>(
    undefined,
  );
  const memberKey = form.members.map((member) => member.id).join(",");
  useEffect(() => {
    if (!resuming) return;
    let cancelled = false;
    void loadDraft(form.groupId).then((found) => {
      if (cancelled) return;
      setStored(found ? draftFields(found.fields, memberKey.split(",")) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [resuming, form.groupId, memberKey]);
  // Seeded into the form, or `undefined` for as long as that is unknown: until
  // the fragment has been read, and then — only when it asks for the draft —
  // until the store has answered.
  const draft: EntryDraftFields | null | undefined =
    params === null ? undefined : resuming ? stored : null;

  /*
   * The debt a link named, if it named one. Priced here, from the balances the
   * route loaded, and not from the link — see `settlePrefill` for why the link
   * carries no amount.
   */
  const intent = params === null ? null : settleIntentOf(params);
  const prefill = intent ? settlePrefill(intent, form.outstanding) : undefined;
  const openSheet = params === null ? undefined : sheetOf(params);
  const filters = params === null ? "" : listQuery(params);

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
            prefill={prefill}
            openSheet={openSheet}
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
                to: to ? withQuery(to, filters) : `/groups/${form.groupId}`,
              })
            }
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
