"use client";

import { useSyncExternalStore, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * A key, drawn as one: the sidebar's ⌘K, the entry dialog's ⌘↵, the
 * chooser's 1 to 9.
 *
 * Only ever a hint beside a control that already does the thing, never the
 * one way to do it — so a caller that draws it beside a sentence a screen
 * reader also hears marks it `aria-hidden`, and says the shortcut on the
 * control itself with `aria-keyshortcuts`.
 *
 * Mono at the foot of the scale, on the card surface with a hairline and a
 * one-pixel lip under it, as the desktop boards draw a key.
 */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-card px-1 font-mono text-2xs font-medium text-muted-foreground shadow-[inset_0_0_0_1px_var(--border),0_1px_0_var(--border)]",
        className,
      )}
      {...props}
    />
  );
}

const subscribeToNothing = () => () => {};

/**
 * The platform's modifier: a Mac's ⌘, everybody else's Ctrl.
 *
 * Read off the browser, so the server — which cannot know — draws the Mac's,
 * and the first client render corrects it.
 */
export function useModifierKey(): "⌘" | "Ctrl" {
  return useSyncExternalStore(
    subscribeToNothing,
    () => (/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"),
    () => "⌘",
  );
}
