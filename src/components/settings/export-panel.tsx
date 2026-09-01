"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Download } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface ExportableGroup {
  readonly id: string;
  readonly name: string;
}

type Format = "csv" | "xlsx";

/**
 * Taking one group's data out, from the account screen rather than the
 * group's.
 *
 * The group's own settings still hold the full export — three formats, JSON
 * included, and the restore that reads a JSON backup back in. This is the
 * shorter question somebody asks from here: "give me a spreadsheet of one of
 * my groups". So it offers the two formats a spreadsheet actually means and
 * sends them to the same route.
 *
 * A plain anchor rather than a fetch. The file is built by a route handler, so
 * the browser downloads it the way it downloads any other link, and the toast
 * only says the request left — there is nothing here that could know when it
 * arrived.
 */
export function ExportPanel({ groups }: { groups: ExportableGroup[] }) {
  const t = useTranslations("userSettings");
  const tGroup = useTranslations("settingsPage");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [format, setFormat] = useState<Format>("csv");

  if (groups.length === 0) {
    return <p className="text-xs text-muted-foreground">{t("noGroups")}</p>;
  }

  return (
    <div className="space-y-3.5">
      <div className="space-y-1.5">
        <label htmlFor="export-group" className="block text-xs font-semibold">
          {t("exportGroup")}
        </label>
        {/* A native select: the list is short, it is one of a set of controls
            rather than a screen of its own, and the platform's own picker is
            better on a phone than anything drawn here. `text-base` is not
            decoration — Safari zooms the page in on any select below 16px and
            never zooms back out. */}
        <div className="relative">
          <select
            id="export-group"
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
            className="h-10 w-full appearance-none rounded-xl border border-input bg-transparent px-3 pr-9 text-base transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none md:text-sm dark:bg-input/30"
          >
            {groups.map((group) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
        </div>
      </div>

      <fieldset className="space-y-1.5">
        <legend className="text-xs font-semibold">{t("exportFormat")}</legend>
        <div className="flex gap-2">
          <Chip
            selected={format === "csv"}
            onClick={() => setFormat("csv")}
            label={tGroup("csv")}
          />
          <Chip
            selected={format === "xlsx"}
            onClick={() => setFormat("xlsx")}
            label={tGroup("excel")}
          />
        </div>
      </fieldset>

      <a
        href={`/api/groups/${groupId}/export?format=${format}`}
        download
        onClick={() =>
          toast.success(
            tGroup("exportStarted", {
              format: format === "csv" ? tGroup("csv") : tGroup("excel"),
            }),
          )
        }
        className="tap-target flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-primary text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Download aria-hidden="true" className="size-4" />
        {t("exportAction")}
      </a>
    </div>
  );
}

/** Selected is a filled chip in the accent; unselected is an outline. */
function Chip({
  selected,
  label,
  onClick,
}: {
  selected: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "tap-target h-8 min-w-16 rounded-full px-3.5 text-xs font-semibold transition-colors",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected
          ? "bg-primary text-primary-foreground"
          : "border border-input text-foreground hover:bg-foreground/6",
      )}
    >
      {label}
    </button>
  );
}
