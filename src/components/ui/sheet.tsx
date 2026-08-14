"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useKeyboardInset } from "@/components/ui/use-keyboard-inset";
import { XIcon } from "lucide-react";

/** Share of its own height a sheet must travel before letting go closes it. */
const DISMISS_THRESHOLD = 0.28;
/** A flick this fast closes it however far it got, in pixels per ms. */
const DISMISS_VELOCITY = 0.5;
/** Movement before a touch is a drag rather than a tap, in pixels. */
const SLOP = 6;
/** Page left showing above a sheet that has been pushed up by a keyboard. */
const HEADROOM = 16;

/**
 * Push a bottom sheet down to dismiss it.
 *
 * The sheet is its own scroll container, which settles the ambiguity the same
 * way iOS does: at the top of the content the gesture moves the sheet, and
 * anywhere else it scrolls. Nothing is prevented until the drag has declared
 * itself, so a tap on a control inside the sheet is still a tap.
 *
 * Closing is handed back to Radix — the sheet is animated to the bottom edge
 * here, then the hidden close is clicked, so state, focus and the overlay all
 * unwind the way they would from any other dismissal.
 */
function useSwipeDismiss(enabled: boolean) {
  const sheet = React.useRef<HTMLDivElement>(null);
  const close = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    const element = sheet.current;
    if (!element || !enabled) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let tracking = false;
    let dragging = false;
    let pointer = -1;
    let startY = 0;
    let lastY = 0;
    let lastAt = 0;
    let velocity = 0;

    const offset = (value: number) => {
      element.style.transform = `translate3d(0, ${value}px, 0)`;
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      // Anywhere but the top of the content, the gesture is a scroll.
      if (element.scrollTop > 0) return;
      tracking = true;
      pointer = event.pointerId;
      startY = lastY = event.clientY;
      lastAt = event.timeStamp;
      velocity = 0;
    };

    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerId !== pointer || (!tracking && !dragging)) return;
      const dy = event.clientY - startY;

      if (tracking) {
        if (dy < SLOP) return;
        tracking = false;
        dragging = true;
        element.style.transition = "none";
      }

      const elapsed = event.timeStamp - lastAt;
      if (elapsed > 0) {
        velocity = (event.clientY - lastY) / elapsed;
        lastY = event.clientY;
        lastAt = event.timeStamp;
      }
      // Pulling up past the top resists rather than lifting the sheet off it.
      offset(dy < 0 ? dy / 4 : dy);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      pointer = -1;
      if (!dragging) {
        tracking = false;
        return;
      }
      dragging = false;

      const travelled = event.clientY - startY;
      const height = element.getBoundingClientRect().height;
      element.style.transition = "transform 320ms cubic-bezier(0.32,0.72,0,1)";

      if (
        travelled > height * DISMISS_THRESHOLD ||
        velocity > DISMISS_VELOCITY
      ) {
        offset(height);
        element.addEventListener(
          "transitionend",
          () => close.current?.click(),
          {
            once: true,
          },
        );
        return;
      }
      offset(0);
    };

    // The sheet must not scroll under a gesture that has become a drag.
    const onTouchMove = (event: TouchEvent) => {
      if (dragging && event.cancelable) event.preventDefault();
    };

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("touchmove", onTouchMove, { passive: false });

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("touchmove", onTouchMove);
    };
  }, [enabled]);

  return { sheet, close };
}

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  style,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) {
  const bottom = side === "bottom";
  const { sheet, close } = useSwipeDismiss(bottom);

  /**
   * A bottom sheet with a keyboard open rides on top of it.
   *
   * Anchored to the bottom edge, a sheet whose content includes a text field —
   * the currency search, the exact-amount rows — puts that field and its Done
   * button behind the keyboard the moment the field takes focus. Sitting the
   * sheet on the keyboard instead is what every native sheet does.
   *
   * Height has to give as well, or the top of the sheet is pushed off-screen
   * in exchange. `dvh` ignores the keyboard by design, so the space actually
   * left is the dynamic viewport minus what the keyboard took.
   *
   * `bottom` rather than a transform: the drag-to-dismiss above owns
   * `transform`, and the two must not fight over it.
   */
  const keyboard = useKeyboardInset();
  const lifted = bottom && keyboard > 0;

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col gap-4 bg-popover bg-clip-padding text-sm text-popover-foreground shadow-lg transition duration-200 ease-in-out data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto data-[side=bottom]:border-t data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4 data-[side=left]:border-r data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4 data-[side=right]:border-l data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto data-[side=top]:border-b data-[side=left]:sm:max-w-sm data-[side=right]:sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-[side=left]:data-open:slide-in-from-left-10 data-[side=right]:data-open:slide-in-from-right-10 data-[side=top]:data-open:slide-in-from-top-10 data-closed:animate-out data-closed:fade-out-0 data-[side=left]:data-closed:slide-out-to-left-10 data-[side=right]:data-closed:slide-out-to-right-10 data-[side=top]:data-closed:slide-out-to-top-10",
          // A bottom sheet comes all the way up from the edge it is anchored
          // to, on the curve the rest of the app moves on. Ten pixels and a
          // fade is a popover pretending to be a sheet.
          bottom &&
            "duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] data-open:slide-in-from-bottom-[100%] data-closed:slide-out-to-bottom-[100%]",
          className,
        )}
        style={
          lifted
            ? {
                bottom: keyboard,
                maxHeight: `calc(100dvh - ${keyboard + HEADROOM}px)`,
                ...style,
              }
            : style
        }
        {...props}
        ref={sheet}
      >
        {/* The grabber says the sheet can be pushed away before anyone tries. */}
        {bottom && (
          <span
            aria-hidden="true"
            data-slot="sheet-grabber"
            className="mx-auto mb-1 h-1 w-9 shrink-0 rounded-full bg-muted-foreground/30"
          />
        )}
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close data-slot="sheet-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-3 right-3"
              size="icon-sm"
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </Button>
          </SheetPrimitive.Close>
        )}
        {/* How the drag hands the dismissal back to Radix. */}
        <SheetPrimitive.Close ref={close} className="hidden" tabIndex={-1} />
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-0.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn(
        "font-heading text-base font-medium text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
