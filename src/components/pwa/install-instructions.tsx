"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Check, Compass, Share, SquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { BalanciaMark } from "@/components/brand/wordmark";
import { usePwaInstall } from "./use-install-prompt";

/**
 * Talks the user through the installs we cannot perform for them.
 *
 * Mounted once, in the app shell, because it is opened from places that cannot
 * share React state — the account menu unmounts its items as it closes. Which
 * of the three panels it shows is decided by the install store, never by the
 * caller, so no browser check is ever duplicated at a call site.
 *
 * A bottom sheet rather than a centred dialog: this only ever opens on a phone
 * or in a browser that behaves like one, and it matches the sheet the "add
 * expense" bar already uses. Radix gives it the focus trap, the escape key and
 * the labelled dialog role.
 */
export function InstallInstructions() {
  const { instructionsOpen, closeInstructions, method, isInstalled } =
    usePwaInstall();
  const t = useTranslations("pwa");

  const bold = (chunks: ReactNode) => (
    <strong className="font-medium text-foreground">{chunks}</strong>
  );

  // Installing while the panel is open — plausible on iOS, where the user
  // leaves for the share sheet and comes back — turns it into a confirmation.
  const panel = isInstalled ? "installed" : method;

  return (
    <Sheet
      open={instructionsOpen}
      onOpenChange={(open) => {
        if (!open) closeInstructions();
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto max-h-[85dvh] gap-4 overflow-y-auto rounded-t-[22px] px-5 pb-[max(1.375rem,env(safe-area-inset-bottom))] sm:max-w-sm"
      >
        {/* The grabber is the sheet's own, now that every bottom sheet has
            one — a second would only sit under the first. */}
        <SheetHeader className="flex-row items-center gap-3 p-0">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent">
            <BalanciaMark className="size-6" />
          </span>
          {/* A div, not a span: the title renders an <h2> and the description
              a <p>, neither of which may sit inside inline content. */}
          <div className="flex min-w-0 flex-col gap-0.5">
            <SheetTitle className="text-base tracking-[-0.02em]">
              {panel === "installed" ? t("alreadyInstalled") : t("install")}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {panel === "ios-browser"
                ? t("openInSafariDescription")
                : panel === "installed"
                  ? t("alreadyInstalledDescription")
                  : t("installDescription")}
            </SheetDescription>
          </div>
        </SheetHeader>

        {panel === "ios-share" && (
          <ol className="flex flex-col gap-2.5 text-sm">
            {(
              [
                [Share, "iosStepShare"],
                [SquarePlus, "iosStepAdd"],
                [Check, "iosStepConfirm"],
              ] as const
            ).map(([Icon, key], index) => (
              <li key={key} className="flex items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <Icon aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 text-muted-foreground">
                  <span className="mr-1.5 tabular-nums">{index + 1}.</span>
                  {t.rich(key, { b: bold })}
                </span>
              </li>
            ))}
          </ol>
        )}

        {panel === "ios-browser" && (
          <p className="flex items-center gap-3 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
            <Compass aria-hidden="true" className="size-5 shrink-0" />
            <span className="min-w-0">
              {t.rich("openInSafari", { b: bold })}
            </span>
          </p>
        )}

        <Button className="h-10 w-full rounded-xl" onClick={closeInstructions}>
          {t("gotIt")}
        </Button>
      </SheetContent>
    </Sheet>
  );
}
