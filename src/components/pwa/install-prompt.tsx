"use client";

import { useState } from "react";
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

  if (availability === "unavailable" || dismissed) {
    return null;
  }

  return (
    <>
      <div className="mb-6 flex items-start gap-3 rounded-xl border bg-accent/40 p-3 sm:hidden">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background">
          <BalanciaMark className="size-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            Add Balancia to your home screen
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Opens full screen, one tap away — no app store needed.
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
            {availability === "manual" ? "Show me how" : "Add to home screen"}
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Dismiss install invitation"
          onClick={dismiss}
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <Dialog open={showIosSteps} onOpenChange={setShowIosSteps}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Balancia to your home screen</DialogTitle>
            <DialogDescription>
              Safari installs web apps from its share menu — two taps and
              Balancia sits beside your other apps.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex items-center gap-3">
              <Share aria-hidden="true" className="size-5 shrink-0" />
              <span>
                Tap <strong className="font-medium">Share</strong> in the
                browser toolbar.
              </span>
            </li>
            <li className="flex items-center gap-3">
              <SquarePlus aria-hidden="true" className="size-5 shrink-0" />
              <span>
                Choose{" "}
                <strong className="font-medium">Add to Home Screen</strong>.
              </span>
            </li>
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}
