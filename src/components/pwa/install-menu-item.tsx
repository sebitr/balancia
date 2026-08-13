"use client";

import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { usePwaInstall } from "./use-install-prompt";

/**
 * "Install Balancia" for the account menu.
 *
 * The deliberate entry point, so it stays available even after the proactive
 * suggestion has been waved away — dismissal silences the nudge, not the
 * choice. It hides itself only when there is genuinely nothing to offer:
 * already installed, or a browser with no install route at all.
 *
 * Selecting it hands off to the store, which fires Chromium's native prompt
 * where one exists and opens the instructions sheet where it does not. The
 * sheet is mounted by the shell, not here, because this item unmounts with the
 * menu the moment it closes.
 */
export function InstallMenuItem() {
  const { canInstall, install } = usePwaInstall();
  const t = useTranslations("pwa");

  if (!canInstall) {
    return null;
  }

  return (
    // The menu closes on select, as it should — this item unmounts with it,
    // and the sheet still opens because the request goes through the store
    // rather than through React state that dies with the menu.
    <DropdownMenuItem onSelect={() => void install()}>
      <Download aria-hidden="true" />
      {t("install")}
    </DropdownMenuItem>
  );
}
