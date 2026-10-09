"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import {
  ProviderMark,
  type ProviderChoice,
} from "@/components/backup/provider-mark";
import { Disclosure } from "@/components/settings/disclosure";
import {
  rovingChoice,
  type RovingChoiceProps,
} from "@/components/ui/roving-choice";
import { cn } from "@/lib/utils";
import type { ProviderTile } from "@/modules/backup/view";
import { providerName } from "./outcome";

/**
 * Step 2's choice: where the backups go.
 *
 * One list of radios, laid out twice by CSS and drawn once. A row in a card
 * below `lg`, and from `lg` a tile in a three-column grid — the spec names
 * those `ProviderRow` and `ProviderTile`, and they are the same element,
 * because drawing both and hiding one would hand a screen reader every
 * provider twice.
 *
 * A provider the administrator has not switched on stays in the list and says
 * so in words. Dashed and dimmed is only the look of it; "Not enabled on this
 * server" over "Ask your administrator" is what tells somebody who cannot see
 * the dashes.
 */

type Group = "account" | "own" | "experimental";

interface Option {
  readonly id: ProviderChoice;
  readonly group: Group;
  readonly available: boolean;
}

/** The three services an account connects to by going there and back. */
const ACCOUNT_PROVIDERS = ["google_drive", "dropbox", "onedrive"] as const;

/**
 * What can be chosen, in the order it is drawn.
 *
 * Infomaniak is not a provider: it is a front door to two of them, kDrive over
 * WebDAV and Swiss Backup over S3. So it is offered when both of those are,
 * and step 3 asks which.
 */
export function pickerOptions(
  tiles: readonly Pick<ProviderTile, "id" | "availability" | "experimental">[],
): Option[] {
  const find = (id: ProviderChoice) => tiles.find((tile) => tile.id === id);
  const on = (id: ProviderChoice) => find(id)?.availability === "available";
  const options: Option[] = [];

  for (const id of ACCOUNT_PROVIDERS) {
    if (find(id)) options.push({ id, group: "account", available: on(id) });
  }
  if (find("s3") && find("webdav")) {
    options.push({
      id: "infomaniak",
      group: "own",
      available: on("s3") && on("webdav"),
    });
  }
  for (const id of ["webdav", "s3"] as const) {
    if (find(id)) options.push({ id, group: "own", available: on(id) });
  }
  // iCloud Drive is not offered, so it has no tile; the filter is belt and
  // braces for a server that sends one anyway.
  for (const tile of tiles) {
    if (tile.experimental && tile.id !== "icloud_drive") {
      options.push({
        id: tile.id,
        group: "experimental",
        available: tile.availability === "available",
      });
    }
  }
  return options;
}

export function ProviderPicker({
  providers,
  selected,
  onSelect,
}: {
  providers: readonly ProviderTile[];
  selected: ProviderChoice | null;
  onSelect: (choice: ProviderChoice) => void;
}) {
  const t = useTranslations("cloudBackup");
  const options = pickerOptions(providers);
  const roving = rovingChoice<ProviderChoice>({
    values: options.map((option) => option.id),
    selected,
    onSelect,
    isDisabled: (id) => !options.find((option) => option.id === id)?.available,
  });

  const labels: Record<Group, string> = {
    account: t("where.account"),
    own: t("where.own"),
    experimental: t("where.experimental"),
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("where.title")}
      className="flex flex-col gap-4.5"
    >
      {(["account", "own", "experimental"] as const).map((group) => {
        const inGroup = options.filter((option) => option.group === group);
        if (inGroup.length === 0) return null;
        return (
          <section key={group} className="flex flex-col gap-2">
            <h3 className="px-1.5 text-2xs font-semibold tracking-[0.09em] text-muted-foreground uppercase">
              {labels[group]}
            </h3>
            {group === "experimental" && (
              <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                <Disclosure label={t("where.expTitle")}>
                  <div className="space-y-2 text-xs text-pretty text-muted-foreground">
                    <p>{t("where.expIntro")}</p>
                    <ul className="list-disc space-y-1 pl-4">
                      <li>{t("where.expUnofficial")}</li>
                      <li>{t("where.expPassword")}</li>
                    </ul>
                  </div>
                </Disclosure>
              </div>
            )}
            <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 lg:grid lg:grid-cols-3 lg:gap-3 lg:overflow-visible lg:rounded-none lg:bg-transparent lg:ring-0">
              {inGroup.map((option) => (
                <ProviderOption
                  key={option.id}
                  option={option}
                  selected={selected === option.id}
                  onSelect={() => onSelect(option.id)}
                  roving={roving(option.id)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ProviderOption({
  option,
  selected,
  onSelect,
  roving,
}: {
  option: Option;
  selected: boolean;
  onSelect: () => void;
  roving: RovingChoiceProps;
}) {
  const t = useTranslations("cloudBackup");
  const nameId = useId();
  const noteId = useId();
  const { id, available } = option;

  const name = (() => {
    switch (id) {
      case "google_drive":
        return t("where.googleDrive");
      case "dropbox":
        return t("where.dropbox");
      case "onedrive":
        return t("where.oneDrive");
      case "infomaniak":
        return t("where.infomaniak");
      case "webdav":
        return t("where.webdav");
      case "s3":
        return t("where.s3");
      case "proton_drive":
        return t("where.proton");
      case "icloud_drive":
        return providerName(id);
    }
  })();

  const hint = (() => {
    switch (id) {
      case "onedrive":
        return t("where.oneDriveHint");
      case "infomaniak":
        return t("where.infomaniakHint");
      case "s3":
        return t("where.s3Hint");
      default:
        return null;
    }
  })();

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-labelledby={nameId}
      aria-describedby={noteId}
      disabled={!available}
      onClick={onSelect}
      {...roving}
      className={cn(
        "tap-target relative flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none",
        // A row below `lg`: a hairline between neighbours, none above the first.
        "border-t border-border first:border-t-0",
        // A tile from `lg`: its own outline, all the way round.
        "lg:min-h-32 lg:flex-col lg:items-start lg:gap-3 lg:rounded-xl lg:border lg:bg-card lg:p-4 lg:first:border-t",
        available
          ? selected
            ? "bg-primary/10 lg:border-primary lg:ring-1 lg:ring-primary"
            : "hover:bg-wash-1"
          : "cursor-not-allowed border-dashed bg-wash-1 text-muted-foreground lg:bg-transparent",
      )}
    >
      <ProviderMark provider={id} className={cn(!available && "opacity-60")} />
      <span className="min-w-0 flex-1 lg:flex-none">
        <span id={nameId} className="block text-sm font-medium text-pretty">
          {name}
        </span>
        <span
          id={noteId}
          className="block text-xs text-pretty text-muted-foreground"
        >
          {available ? (
            hint
          ) : (
            <>
              <span className="block font-medium">{t("where.disabled")}</span>{" "}
              <span className="block">{t("where.disabledHelp")}</span>
            </>
          )}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border border-input lg:absolute lg:top-3.5 lg:right-3.5",
          selected && "border-primary bg-primary text-primary-foreground",
          !available && "invisible",
        )}
      >
        {selected && <Check className="size-3.5" strokeWidth={3} />}
      </span>
    </button>
  );
}
