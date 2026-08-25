"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { openOnContent, Sheet, SheetContent } from "@/components/ui/sheet";
import { CurrencyPicker } from "@/components/money/currency-picker";
import { toastUndoable } from "@/components/ui/sonner";
import { setPreferredCurrencyAction } from "@/modules/profile/actions";

/**
 * The currency the home screen totals into.
 *
 * The row is the whole control: title, what it actually does, and the code on
 * the right. Pressing it opens the app's own currency picker — the same
 * full-height sheet with the same favourites and the same search that every
 * other currency question in Balancia opens, because a second picker built for
 * this one screen would be a second list to keep in step with the catalogue.
 *
 * Saved on selection, and the confirmation offers the way back, because the
 * way forward is a list of 165 currencies and the one that was there a moment
 * ago is somewhere in it. Undoing writes the old code the same way and says
 * nothing more — the row showing it again is the answer.
 */
export function CurrencyRow({ current }: { current: string }) {
  const router = useRouter();
  const t = useTranslations("userSettings");
  const tCommon = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState(current);
  const [isPending, startTransition] = useTransition();

  const choose = (chosen: string, announce = true) => {
    const previous = code;
    // The row states what is chosen rather than merely starting there, so it
    // has to show the new code at once — and go back to the old one if the
    // save is refused, rather than claiming a choice the account did not keep.
    setCode(chosen);
    startTransition(async () => {
      const result = await setPreferredCurrencyAction(chosen);
      if (!result.ok) {
        setCode(previous);
        toast.error(result.error ?? t("currencyFailed"));
        return;
      }
      if (announce) {
        toastUndoable(
          t("currencySaved"),
          { label: tCommon("undo"), onUndo: () => choose(previous, false) },
          { id: "preferred-currency" },
        );
      }
      router.refresh();
    });
  };

  return (
    <>
      <button
        type="button"
        disabled={isPending}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="flex w-full shrink-0 items-center gap-3 rounded-xl bg-card px-4 py-4 text-left text-card-foreground ring-1 ring-foreground/10 transition-colors hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
      >
        <span className="min-w-0 flex-1 space-y-1">
          <span className="block font-heading text-base font-semibold">
            {t("currencyTitle")}
          </span>
          <span className="block text-xs text-pretty text-muted-foreground">
            {t("currencyHelp")}
          </span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-primary">
          {code}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // Opening on the search field would put a keyboard over the
          // favourites the sheet exists to show.
          onOpenAutoFocus={openOnContent}
          className="h-[min(800px,calc(100dvh-48px-env(safe-area-inset-top)))] max-h-[calc(100%-48px-env(safe-area-inset-top))] gap-0 overflow-hidden rounded-t-[28px] bg-card pt-2.5 text-card-foreground"
        >
          <CurrencyPicker
            value={code}
            title={t("currencyTitle")}
            onSelect={(chosen) => {
              // Closed first: a toast raised under an open sheet is a toast
              // whose Undo button takes no taps.
              setOpen(false);
              choose(chosen);
            }}
            onBack={() => setOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}
