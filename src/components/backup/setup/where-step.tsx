"use client";

import { useTranslations } from "next-intl";
import type { ProviderChoice } from "@/components/backup/provider-mark";
import type { ProviderTile } from "@/modules/backup/view";
import { StepFooter, type FooterAction } from "./fields";
import { ProviderPicker } from "./provider-picker";

/**
 * Step 2: where the backups go.
 *
 * Nothing is saved by choosing. The pick travels in the address when Continue
 * is pressed, which is what lets step 3 draw itself after a reload, and the
 * browser's Back button return here with the same row chosen.
 */
export function WhereStep({
  providers,
  selected,
  onSelect,
  replacedName,
  secondary,
  onContinue,
  busy,
}: {
  providers: readonly ProviderTile[];
  selected: ProviderChoice | null;
  onSelect: (choice: ProviderChoice) => void;
  /** The provider this setup takes over from, when it is a change of place. */
  replacedName: string | null;
  secondary: FooterAction;
  onContinue: () => void;
  busy: boolean;
}) {
  const t = useTranslations("cloudBackup");
  return (
    <>
      <div className="space-y-1 px-1.5">
        <h2 className="font-heading text-base font-semibold">
          {t("where.title")}
        </h2>
        {replacedName && (
          <p className="text-xs text-pretty text-muted-foreground">
            {t("where.replaceNote", { provider: replacedName })}
          </p>
        )}
      </div>
      <ProviderPicker
        providers={providers}
        selected={selected}
        onSelect={onSelect}
      />
      <StepFooter
        secondary={secondary}
        primary={{
          label: t("setup.continue"),
          onClick: onContinue,
          disabled: selected === null,
          pending: busy,
        }}
      />
    </>
  );
}
