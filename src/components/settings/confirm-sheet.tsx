"use client";

import { useState, type ReactNode } from "react";
import { AlertDialog as AlertDialogPrimitive } from "radix-ui";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The one thing in settings that asks twice.
 *
 * Everything else here writes the moment it is touched and offers Undo, which
 * works because everything else has a way back. Signing out and deleting an
 * account do not: the first ends the session the Undo button would live in,
 * and the second removes the account that would have to be restored. So those
 * two, and only those two, stop and ask — and they ask *before* acting rather
 * than offering to reverse it afterwards.
 *
 * A sheet from the bottom rather than a box in the middle: it arrives from the
 * edge the thumb is already at, and the two answers land where the thumb rests
 * rather than at the top of a phone held one-handed. `AlertDialog` underneath,
 * not `Dialog` — it takes focus, it traps it, and Escape leaves through the
 * cancel rather than dismissing an unanswered question.
 *
 * The confirm button holds its own pending state. These are slow actions with
 * a redirect at the end, and a sheet that sits inert after a tap is a sheet
 * somebody taps again.
 */
export function ConfirmSheet({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  destructive = false,
  children,
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel: string;
  /** May be async; the sheet stays put and busy until it settles. */
  onConfirm: () => unknown;
  destructive?: boolean;
  /** Extra content between the body and the buttons — a confirmation field. */
  children?: ReactNode;
}) {
  const t = useTranslations("userSettings");
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-scrim duration-150",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <AlertDialogPrimitive.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-md flex-col gap-4",
            "rounded-t-[22px] bg-card p-4.5 text-card-foreground ring-1 ring-foreground/10",
            "pb-[calc(1.125rem+env(safe-area-inset-bottom))] duration-150 outline-none",
            "data-open:animate-in data-open:slide-in-from-bottom-full",
            "data-closed:animate-out data-closed:slide-out-to-bottom-full",
          )}
        >
          <div className="space-y-1.5">
            <AlertDialogPrimitive.Title className="font-heading text-base font-semibold">
              {title}
            </AlertDialogPrimitive.Title>
            <AlertDialogPrimitive.Description className="text-xs leading-relaxed text-pretty text-muted-foreground">
              {body}
            </AlertDialogPrimitive.Description>
          </div>

          {children}

          {/* The way out is listed first in the DOM, so it is what a screen
              reader reaches first and what Escape maps onto — but it is drawn
              second, under the thumb, because the answer people came to give
              is usually the other one. */}
          <div className="flex flex-col-reverse gap-2">
            <AlertDialogPrimitive.Cancel asChild>
              <Button variant="outline" className="h-11 rounded-[14px] text-sm">
                {t("keepIt")}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant={destructive ? "destructive" : "default"}
              disabled={busy}
              onClick={() => void confirm()}
              className="h-11 rounded-[14px] text-sm font-semibold"
            >
              {busy && <Loader2 aria-hidden="true" className="animate-spin" />}
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  );
}
