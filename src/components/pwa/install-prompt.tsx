"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Share, SquarePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BalanciaMark } from "@/components/brand/wordmark";
import { useInstallPrompt } from "./use-install-prompt";

/**
 * Invites the visitor to install Balancia on their home screen.
 *
 * Phones only — `sm:hidden` keeps it off desktop, where Chromium also fires
 * the install event but the browser's own address-bar affordance is right
 * there and a banner would just be in the way.
 *
 * Two routes, because the platforms differ: Chromium lets us open the real
 * install sheet, while iOS has no install API and the best we can do is point
 * at the share sheet. Dismissal is remembered; after that the browser's own
 * menu remains the way in, which is why this stays a nudge and not a wall.
 */
export function InstallPrompt() {
  const { availability, dismissed, install, dismiss } = useInstallPrompt();
  const [showIosSteps, setShowIosSteps] = useState(false);
  const t = useTranslations("pwa");

  if (availability === "unavailable" || dismissed) {
    return null;
  }

  const bold = (chunks: React.ReactNode) => (
    <strong className="font-medium">{chunks}</strong>
  );

  return (
    <>
      <div className="mb-6 flex items-start gap-3 rounded-xl border bg-accent/40 p-3 sm:hidden">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background">
          <BalanciaMark className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{t("title")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t("subtitle")}
          </p>
          <Button
            size="sm"
            className="mt-2.5"
            onClick={() => {
              if (availability === "manual") {
                setShowIosSteps(true);
              } else {
                void install();
              }
            }}
          >
            {availability === "manual" ? t("showMeHow") : t("addToHomeScreen")}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("dismiss")}
          onClick={dismiss}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <Dialog open={showIosSteps} onOpenChange={setShowIosSteps}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("iosIntro")}</DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <Share aria-hidden="true" className="size-5 shrink-0" />
              <span>{t.rich("iosStepShare", { b: bold })}</span>
            </li>
            <li className="flex items-center gap-3">
              <SquarePlus aria-hidden="true" className="size-5 shrink-0" />
              <span>{t.rich("iosStepAdd", { b: bold })}</span>
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
