"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { BalanciaMark } from "@/components/brand/wordmark";
import { usePwaInstall } from "./use-install-prompt";

/**
 * A one-time nudge to install, shown once Balancia has earned it.
 *
 * Placement is the whole of the "when": the dashboard renders this only on the
 * branch where the visitor already belongs to a group, so a brand-new account
 * never meets it on first load — it appears after the first group is created
 * or joined, which is the first point the app is worth keeping.
 *
 * Phones only. Desktop Chromium fires the same install event, but its own
 * address-bar affordance is right there and the account menu carries the
 * action, so a banner would only be in the way.
 *
 * Waving it away is remembered across visits; the account menu remains the way
 * in afterwards, which is what keeps this a suggestion rather than a wall.
 */
export function InstallPrompt() {
  const { canInstall, suggestionDismissed, install, dismissSuggestion } =
    usePwaInstall();
  const t = useTranslations("pwa");

  if (!canInstall || suggestionDismissed) {
    return null;
  }

  return (
    <section
      aria-labelledby="install-suggestion-title"
      className="mb-6 flex items-start gap-3 rounded-xl border bg-accent/40 p-3 sm:hidden"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background">
        <BalanciaMark className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <p id="install-suggestion-title" className="text-sm font-medium">
          {t("install")}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t("installDescription")}
        </p>
        <div className="mt-2.5 flex items-center gap-2">
          <Button size="sm" onClick={() => void install()}>
            {t("installAction")}
          </Button>
          <Button size="sm" variant="ghost" onClick={dismissSuggestion}>
            {t("notNow")}
          </Button>
        </div>
      </div>
    </section>
  );
}
