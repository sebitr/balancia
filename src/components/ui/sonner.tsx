"use client";

import { useRef } from "react";
import { useTheme } from "next-themes";
import { useTranslations } from "next-intl";
import { Toaster as Sonner, toast, type ToasterProps } from "sonner";
import {
  CheckIcon,
  CircleAlertIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
  XIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * How long a toast that can still be taken back stays on screen.
 *
 * Longer than the four seconds a plain confirmation gets: this one is not
 * read, it is *decided on*, and the decision needs the sentence, the button
 * and a moment of doubt to fit inside it.
 */
export const UNDO_WINDOW = 8000;

/** Past this many pixels the pointer was swiping the toast, not tapping it. */
const TAP_SLOP = 10;

/**
 * The glyph a toast leads with.
 *
 * A tinted disc rather than a bare stroke: at this size the outline alone does
 * not separate a confirmation from a caution across a room, and the colour is
 * never carrying the meaning on its own — the shape inside says it too, which
 * is what WCAG 2.2 1.4.1 asks for.
 */
function Glyph({ icon: Icon, tone }: { icon: LucideIcon; tone: string }) {
  return (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-full",
        tone,
      )}
    >
      <Icon aria-hidden="true" className="size-4" />
    </span>
  );
}

/**
 * The application's toasts.
 *
 * Sonner's own skin is turned off (`unstyled`) and the whole surface is drawn
 * here instead. That is not only taste: sonner injects its stylesheet at
 * import time, after this app's, so at equal specificity its rules win —
 * overriding them one property at a time is a fight, whereas leaving them
 * unwritten is not.
 *
 * Three ways out, because a toast that has to be aimed at is a toast that gets
 * left to time out: the close button, a tap anywhere on it, and a swipe back
 * the way it came in.
 */
const Toaster = ({
  position = "top-center",
  closeButton = true,
  // It arrived from the top, so up is the way it goes back.
  swipeDirections = ["top"],
  ...props
}: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const t = useTranslations("common");
  const tapOrigin = useRef<{ x: number; y: number } | null>(null);

  /**
   * A tap anywhere on a toast dismisses it.
   *
   * Sonner has no such option, so the toast's own close button is the one that
   * gets pressed — that way a tap, a click on the ✕ and the keyboard all leave
   * through the same door, with the same exit animation and the same
   * `onDismiss`. A toast that refuses to be dismissed has no close button and
   * so ignores this, which is the right answer for it.
   */
  const dismissOnTap = (event: React.MouseEvent) => {
    const origin = tapOrigin.current;
    tapOrigin.current = null;

    const target = event.target as HTMLElement | null;
    // The buttons already say what they do; a link is going somewhere.
    if (!target || target.closest("[data-button], [data-close-button], a")) {
      return;
    }
    // A swipe that fell short of the threshold ends in a click event too, and
    // dismissing on it would take the toast away from someone who just
    // decided not to.
    if (
      origin &&
      Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > TAP_SLOP
    ) {
      return;
    }

    target
      .closest("[data-sonner-toast]")
      ?.querySelector<HTMLButtonElement>("[data-close-button]")
      ?.click();
  };

  return (
    // `contents`: a wrapper only so the taps have somewhere to land. It must
    // not be a box of its own — the toaster below it positions itself against
    // the viewport.
    <div
      className="contents"
      onPointerDownCapture={(event) => {
        tapOrigin.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={dismissOnTap}
    >
      <Sonner
        theme={theme as ToasterProps["theme"]}
        className="toaster group"
        position={position}
        closeButton={closeButton}
        swipeDirections={swipeDirections}
        icons={{
          success: (
            <Glyph icon={CheckIcon} tone="bg-positive/15 text-positive" />
          ),
          info: (
            <Glyph icon={InfoIcon} tone="bg-notice-info/15 text-notice-info" />
          ),
          warning: (
            <Glyph
              icon={TriangleAlertIcon}
              tone="bg-notice-warning/15 text-notice-warning"
            />
          ),
          error: (
            <Glyph
              icon={CircleAlertIcon}
              tone="bg-destructive/15 text-destructive"
            />
          ),
          loading: (
            <Glyph
              icon={Loader2Icon}
              tone="bg-muted text-muted-foreground [&>svg]:animate-spin"
            />
          ),
          close: <XIcon aria-hidden="true" className="size-4" />,
        }}
        // The safe area, then the same inset the screens use. A toast landing
        // under a notch is a toast nobody reads.
        mobileOffset={{
          top: "calc(env(safe-area-inset-top) + 0.75rem)",
          left: "0.75rem",
          right: "0.75rem",
        }}
        toastOptions={{
          unstyled: true,
          closeButtonAriaLabel: t("dismiss"),
          classNames: {
            // `w-full` is the toaster's width, which sonner narrows to the
            // viewport itself below 600px.
            toast: cn(
              "relative flex w-full items-center gap-3 rounded-xl p-3 pr-11",
              "bg-popover/90 text-popover-foreground backdrop-blur-xl",
              "shadow-toast ring-1 ring-[color-mix(in_oklch,var(--foreground)_12%,transparent)]",
            ),
            icon: "shrink-0",
            content: "flex min-w-0 flex-1 flex-col gap-0.5",
            title: "text-sm leading-snug font-semibold",
            description: "text-xs leading-snug text-muted-foreground",
            actionButton: cn(
              "ml-auto flex h-8 shrink-0 cursor-pointer items-center rounded-full px-3.5",
              "bg-secondary text-xs font-semibold text-secondary-foreground",
              "transition-colors hover:bg-accent focus-visible:outline-2",
              "focus-visible:outline-offset-2 focus-visible:outline-ring",
            ),
            cancelButton: cn(
              "flex h-8 shrink-0 cursor-pointer items-center rounded-full px-3.5",
              "text-xs font-semibold text-muted-foreground",
              "transition-colors hover:text-foreground",
            ),
            closeButton: cn(
              "absolute top-1/2 right-2.5 flex size-7 -translate-y-1/2 cursor-pointer",
              "items-center justify-center rounded-full text-muted-foreground",
              "transition-colors hover:bg-foreground/8 hover:text-foreground",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
            ),
          },
        }}
        {...props}
      />
    </div>
  );
};

/**
 * A confirmation that can be taken back for as long as it is on screen.
 *
 * Only for changes that have a genuine way back — the undo has to *do* the
 * reverse, not pretend to. Where none exists, a plain `toast.success` is the
 * honest answer.
 */
export function toastUndoable(
  message: string,
  /** `onUndo` may be async; whatever it returns is nobody's business here. */
  undo: { label: string; onUndo: () => unknown },
  /**
   * `id` names the toast. A surface that confirms over and over — a settings
   * card writing itself as it is edited — passes one, and each confirmation
   * then replaces the one already on screen, with its eight seconds starting
   * again, rather than stacking a column of them.
   */
  options?: { id?: string | number },
) {
  return toast.success(message, {
    id: options?.id,
    duration: UNDO_WINDOW,
    action: {
      label: undo.label,
      onClick: () => void undo.onUndo(),
    },
  });
}

export { Toaster };
