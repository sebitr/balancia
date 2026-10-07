"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PUSH } from "@/components/motion/transitions";
import { readSingleKeys } from "./single-keys";

/**
 * The app's keyboard, on a desk: one listener for the whole shell, mounted
 * once by `CommandPaletteProvider` in `app-shell.tsx`.
 *
 *   ⌘K (Ctrl K)  Search or jump to — opens the palette, or closes it.
 *   N            Add expense: to this group inside one, "Add to which
 *                group?" outside.
 *   S            Settle up in this group. Nothing outside a group.
 *   ⌘\ (Ctrl \)  Folds the sidebar to its icons, or opens it again.
 *
 * Every one of them presses a control that is already on the screen, and none
 * is the only way to anything. N and ⌘\ press the sidebar's own buttons — the
 * ones carrying `data-shortcut` — so a key does exactly what a click there
 * does: the group's Add goes into the drawer, or to the offline form when the
 * network is gone; outside a group it asks which group first; and the fold is
 * remembered for the device as a click would. S goes where the overview's
 * Settle up goes.
 *
 * ## When a key is left alone
 *
 * From `lg` up only. Below it there is no sidebar and nothing here changes —
 * a tablet with a keyboard keeps the phone's layout and its keys.
 *
 * N and S are single characters, so they fire only when nothing is being
 * typed: no field, select, editable region or list with its own typeahead
 * has the focus, and nothing is open over the screen — a dialog, a sheet, a
 * menu, the palette itself. And only while the "Single-key shortcuts" switch
 * is on (WCAG 2.1.4; see `single-keys.ts`). The keys with a modifier work from
 * a field too, as ⌘K does everywhere, but not under a dialog: the sidebar they
 * reach for is behind it.
 *
 * ## Esc
 *
 * Esc is not here. Every surface that can be closed is a Radix layer, and
 * Radix closes the topmost one only — the menu over the palette, then the
 * palette, then the dialog under it, which is the order the rules board asks
 * for. A second listener here would close the palette under an open menu.
 */

/** `lg`, 64rem: where the sidebar, and with it every shortcut, begins. */
export const DESK_QUERY = "(min-width: 64rem)";

/** A Mac's ⌘ rather than everybody else's Ctrl. */
export function isApplePlatform(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.platform);
}

/**
 * The platform's command key is held: ⌘ on a Mac, Ctrl everywhere else.
 *
 * Only the platform's own: Ctrl K on a Mac is the text field's "delete to the
 * end of the line", and it has to keep meaning that.
 */
export function commandHeld(event: KeyboardEvent): boolean {
  return isApplePlatform() ? event.metaKey : event.ctrlKey;
}

/** No modifier at all: the bare letter. */
function bare(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

/**
 * Anything a typed letter belongs to: a field, a select, an editable region,
 * or a widget that answers letters with typeahead — a listbox, a menu, a
 * Radix select's trigger (`combobox`), a tree or a grid.
 */
const TAKES_LETTERS = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  "[role='textbox']",
  "[role='searchbox']",
  "[role='combobox']",
  "[role='listbox']",
  "[role='menu']",
  "[role='menubar']",
  "[role='tree']",
  "[role='grid']",
].join(", ");

export function isTyping(target: EventTarget | null): boolean {
  return [target, document.activeElement].some(
    (node) => node instanceof Element && node.closest(TAKES_LETTERS) !== null,
  );
}

/**
 * Something open over the screen: a dialog or a sheet (both `dialog` in
 * Radix), a popover (also `dialog`), a confirmation, a menu or a select's
 * list. A closing one is already `closed`, so a key pressed during its exit
 * is not held up by it.
 */
const OPEN_LAYER = [
  "[role='dialog'][data-state='open']",
  "[role='alertdialog'][data-state='open']",
  "[role='menu'][data-state='open']",
  "[role='listbox'][data-state='open']",
  "dialog[open]",
].join(", ");

export function isLayerOpen(): boolean {
  return document.querySelector(OPEN_LAYER) !== null;
}

/**
 * Presses the sidebar's control for a shortcut, when it has one on screen.
 *
 * Inside the sidebar only, so a control that happens to carry the same hook
 * somewhere on the screen is never the one pressed.
 */
export function pressShortcut(shortcut: string): boolean {
  const control = document.querySelector<HTMLElement>(
    `[data-slot="app-sidebar"] [data-shortcut="${shortcut}"]`,
  );
  if (!control) return false;
  control.click();
  return true;
}

export function useShortcuts({
  groupId,
  paletteOpen,
  setPaletteOpen,
}: {
  /** The group the screen belongs to, which S settles up in. */
  groupId: string | null;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
}): void {
  const router = useRouter();

  // Read when a key is pressed, so the listener is attached once for the
  // shell's life and never misses a key while it is being swapped.
  const latest = useRef({ groupId, paletteOpen, setPaletteOpen, router });
  useEffect(() => {
    latest.current = { groupId, paletteOpen, setPaletteOpen, router };
  });

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat) return;
      if (!window.matchMedia(DESK_QUERY).matches) return;
      const { groupId, paletteOpen, setPaletteOpen, router } = latest.current;
      const key = event.key.toLowerCase();

      if (
        commandHeld(event) &&
        !event.altKey &&
        !event.shiftKey &&
        key === "k"
      ) {
        if (paletteOpen) {
          setPaletteOpen(false);
        } else if (!isLayerOpen()) {
          setPaletteOpen(true);
        } else {
          return;
        }
        event.preventDefault();
        return;
      }

      // By the character, whatever else it took to type it — a French Mac
      // keyboard's backslash is ⌥⇧/ — and by the key's place on the board
      // where the layout puts something else there.
      if (
        commandHeld(event) &&
        (event.key === "\\" || event.code === "Backslash")
      ) {
        if (isLayerOpen()) return;
        if (pressShortcut("mod+backslash")) event.preventDefault();
        return;
      }

      if (!bare(event) || (key !== "n" && key !== "s")) return;
      if (isTyping(event.target) || isLayerOpen() || !readSingleKeys()) return;

      if (key === "n") {
        if (pressShortcut("n")) event.preventDefault();
        return;
      }

      if (groupId === null) return;
      const settle = `/groups/${groupId}/settle`;
      event.preventDefault();
      if (window.location.pathname === settle) return;
      router.push(settle, { transitionTypes: PUSH });
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
