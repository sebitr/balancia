"use client";

import { useTranslations } from "next-intl";
import { Download } from "lucide-react";
import { SettingsButtonRow } from "@/components/settings/settings-row";
import { usePwaInstall } from "./use-install-prompt";

/**
 * "Install Balancia", as a row on the Help & about screen.
 *
 * The deliberate entry point, so it stays available even after the proactive
 * suggestion has been waved away — dismissal silences the nudge, not the
 * choice. It hides itself only when there is genuinely nothing to offer:
 * already installed, or a browser with no install route at all.
 *
 * It used to live in the account dropdown. That menu is a link to the settings
 * hub now, and this belongs with the other facts about the app rather than
 * among the account's own settings: installing is something you do to
 * Balancia on this device, not something you set about yourself.
 *
 * Selecting it hands off to the store, which fires Chromium's native prompt
 * where one exists and opens the instructions sheet where it does not. The
 * sheet is mounted by the shell, not here.
 */
export function InstallRow() {
  const { canInstall, install } = usePwaInstall();
  const t = useTranslations("pwa");

  if (!canInstall) {
    return null;
  }

  return (
    <SettingsButtonRow
      icon={Download}
      label={t("install")}
      onClick={() => void install()}
    />
  );
}
