/**
 * How wide a dialog grows, and the geometry of a bottom sheet that becomes one
 * on a desk.
 *
 * Three widths, named for what goes in them:
 *
 *   sm — a question and its answer: a confirmation, a field or two. 24rem,
 *        what every dialog was before there were sizes.
 *   md — a short list to pick from: the group chooser, a payment method, a
 *        schedule. 30rem.
 *   lg — a form with room to lay its parts side by side: the entry dialog.
 *        45rem at `lg` and 55rem from `xl` — 720 and 880px, as the desktop
 *        rules board sizes it — because at 1024 the window beside the sidebar
 *        has no room for 880 and the form stacks its amount over its
 *        description instead.
 *
 * No `"use client"`, and on purpose, for the reason `entries/entry-sheet.tsx`
 * gives at length: the entry drawer's loading boundary is a Server Component,
 * and a string read through a client module reaches it as a client reference
 * rather than as the classes — `cn()` drops it without a word.
 */

export type DialogSize = "sm" | "md" | "lg";

/** A dialog's width from `sm` up, as `DialogContent` takes it. */
export const DIALOG_WIDTH: Record<DialogSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-[30rem]",
  lg: "sm:max-w-[45rem] xl:max-w-[55rem]",
};

/**
 * The same widths, for a bottom sheet that is a dialog from `lg` only — below
 * it the sheet keeps the phone's width it has from `md` (see `SheetContent`).
 */
const DESK_WIDTH: Record<DialogSize, string> = {
  sm: "lg:max-w-sm",
  md: "lg:max-w-[30rem]",
  lg: "lg:max-w-[45rem] xl:max-w-[55rem]",
};

/**
 * A bottom sheet, from `lg` up, drawn as a dialog: off the foot of the window
 * and into its upper middle, every edge drawn and every corner rounded, and in
 * on a fade and a few pixels rather than the whole height a sheet rises.
 *
 * Anchored by its top rather than centred. A form whose height follows what
 * it holds — a split opened, a tab changed — would otherwise grow from both
 * edges at once, and the title the reader is reading would move under them.
 * The bottom gives way instead, down to the cap, past which the form's own
 * body scrolls.
 *
 * Each edge is said twice where the sheet states it from a `[data-side]`
 * selector, which outranks a plain utility: `lg:data-[side=bottom]:` for the
 * sheet itself, plain `lg:` for a placeholder drawn in its shape without being
 * one — the entry drawer's loading boundary. The grabber goes and the swipe
 * stops: `SheetContent` does both when it is asked for this.
 */
export function deskDialogClass(size: DialogSize): string {
  return `${DESK_WIDTH[size]} lg:bottom-auto lg:data-[side=bottom]:bottom-auto lg:top-[max(2.5rem,6dvh)] lg:max-h-[calc(100dvh-5rem)] lg:rounded-[20px] lg:border lg:shadow-xl lg:duration-200 lg:data-open:slide-in-from-bottom-2 lg:data-closed:slide-out-to-bottom-2`;
}
