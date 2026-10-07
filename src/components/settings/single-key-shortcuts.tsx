"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { rememberSingleKeys } from "@/components/layout/single-keys";
import { SettingsCard } from "./settings-card";
import { SettingsControlRow } from "./settings-row";

/**
 * Whether N and S do anything on this device — the switch WCAG 2.1.4 asks for
 * wherever a shortcut is a single letter. See `layout/single-keys.ts`.
 *
 * From `lg` up only, where the keys are: below it there is no sidebar, no
 * shortcut, and so nothing for the switch to turn off.
 *
 * Silent, like every switch in settings: it is written the moment it moves
 * and moving it back is the same switch under the same finger. Nothing can
 * refuse it — the browser writes its own cookie — so there is no failure to
 * speak either.
 */
export function SingleKeyShortcuts({ initialOn }: { initialOn: boolean }) {
  const t = useTranslations("userSettings");
  const [on, setOn] = useState(initialOn);

  return (
    <SettingsCard className="hidden lg:block">
      <SettingsControlRow
        htmlFor="single-key-shortcuts"
        label={t("singleKeys")}
        description={t("singleKeysHelp")}
        control={
          <Switch
            id="single-key-shortcuts"
            size="lg"
            checked={on}
            onCheckedChange={(next) => {
              setOn(next);
              rememberSingleKeys(next);
            }}
          />
        }
      />
    </SettingsCard>
  );
}
