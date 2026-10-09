"use client";

import { useRef, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { FileLock, FileUp, Info, Loader2 } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { rovingChoice } from "@/components/ui/roving-choice";
import { useDateFormatter, useNumberLocale } from "@/i18n/format-context";
import { cn } from "@/lib/utils";
import { formatBytes } from "../format";
import type { CloudFile } from "./cloud";
import { NoticeAlert } from "./notice";
import type { CloudList } from "./use-cloud-backups";

export type SourceKind = "cloud" | "file";

/** What the "From my cloud" choice needs: where, and what is there. */
export interface CloudSource {
  /** The provider's display name, for the sentences that name it. */
  readonly provider: string;
  readonly list: CloudList;
  readonly retry: () => void;
  /** The backup picked in the list, or null before the list has arrived. */
  readonly chosen: string | null;
  readonly onChoose: (name: string) => void;
}

/**
 * Step one of restoring: which backup.
 *
 * Two ways in. The person's connected cloud, listed newest first with the
 * newest already chosen, because "put back the latest" is nearly every
 * restore; and a file, for the day this server or its cloud connection is the
 * thing that was lost. With no cloud to offer there is nothing to choose
 * between, so the chips go and only the file is shown.
 */
export function SourceCard({
  cloud,
  source,
  onSource,
  file,
  onFile,
  disabled,
}: {
  /** Null when this server has no cloud to list. */
  cloud: CloudSource | null;
  source: SourceKind;
  onSource: (source: SourceKind) => void;
  file: File | null;
  onFile: (file: File) => void;
  disabled: boolean;
}) {
  const t = useTranslations("cloudBackup");

  return (
    <SettingsCard title={t("restore.sourceTitle")}>
      <div className="space-y-3.5">
        {cloud && (
          <div
            role="group"
            aria-label={t("restore.sourceTitle")}
            className="flex flex-wrap gap-2"
          >
            <Chip
              selected={source === "cloud"}
              label={t("restore.fromCloud")}
              onClick={() => onSource("cloud")}
              disabled={disabled}
            />
            <Chip
              selected={source === "file"}
              label={t("restore.fromFile")}
              onClick={() => onSource("file")}
              disabled={disabled}
            />
          </div>
        )}

        {cloud && source === "cloud" ? (
          <CloudChoice cloud={cloud} disabled={disabled} />
        ) : (
          <FileChoice file={file} onFile={onFile} disabled={disabled} />
        )}
      </div>
    </SettingsCard>
  );
}

function CloudChoice({
  cloud,
  disabled,
}: {
  cloud: CloudSource;
  disabled: boolean;
}) {
  const t = useTranslations("cloudBackup");
  const tCommon = useTranslations("common");
  const { list, provider } = cloud;

  if (list.status === "loading") {
    return (
      <p
        role="status"
        className="flex items-center gap-2 py-1 text-xs text-muted-foreground"
      >
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        {tCommon("loading")}
      </p>
    );
  }

  if (list.status === "failed") {
    return (
      <NoticeAlert
        notice={{ kind: "cloud", code: list.code }}
        provider={provider}
      >
        <Button type="button" variant="outline" size="sm" onClick={cloud.retry}>
          {tCommon("retry")}
        </Button>
      </NoticeAlert>
    );
  }

  if (list.files.length === 0) {
    return (
      <div className="flex gap-2.5 rounded-xl bg-wash-1 p-3 text-xs text-muted-foreground ring-1 ring-border">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <p>{t("restore.cloudEmpty", { provider })}</p>
      </div>
    );
  }

  return (
    <BackupRows
      files={list.files}
      chosen={cloud.chosen}
      onChoose={cloud.onChoose}
      disabled={disabled}
    />
  );
}

/** The backups at the cloud, one radio row each. */
function BackupRows({
  files,
  chosen,
  onChoose,
  disabled,
}: {
  files: readonly CloudFile[];
  chosen: string | null;
  onChoose: (name: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations("cloudBackup");
  const dates = useDateFormatter();
  const rove = rovingChoice({
    values: files.map((file) => file.name),
    selected: chosen,
    onSelect: onChoose,
  });

  return (
    <div
      role="radiogroup"
      aria-label={t("restore.fromCloud")}
      className="overflow-hidden rounded-xl border border-border"
    >
      {files.map((file) => {
        const checked = file.name === chosen;
        return (
          <button
            key={file.name}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            onClick={() => onChoose(file.name)}
            {...rove(file.name)}
            className={cn(
              "flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors",
              "hover:bg-wash-1 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset",
              "disabled:pointer-events-none disabled:opacity-50",
              "not-first:border-t not-first:border-border",
              checked && "bg-wash-3 hover:bg-wash-3",
            )}
          >
            <Tile />
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block text-sm",
                  checked ? "font-semibold" : "font-medium",
                )}
              >
                {dates.at(file.takenAt, { time: "short" })}
              </span>
              <span className="block font-mono text-xs break-all text-muted-foreground">
                {file.name}
              </span>
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full border",
                checked ? "border-primary bg-primary" : "border-input",
              )}
            >
              {checked && (
                <span className="size-2 rounded-full bg-primary-foreground" />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A backup file, or the place to put one. */
function FileChoice({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile: (file: File) => void;
  disabled: boolean;
}) {
  const t = useTranslations("cloudBackup");
  const numbers = useNumberLocale();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const choose = () => input.current?.click();

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (disabled || !event.dataTransfer.types.includes("Files")) return;
    // Without this the browser opens the dropped file in the tab instead.
    event.preventDefault();
    setOver(true);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    const dropped = event.dataTransfer.files[0];
    if (!disabled && dropped) onFile(dropped);
  };

  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      {/* The picker is the browser's own; the button and the drop zone are how
          it is reached. `hidden` keeps the bare input out of the tab order and
          the reading order, and `click()` opens it from either. */}
      <input
        ref={input}
        type="file"
        accept=".age"
        hidden
        aria-label={t("restore.chooseFile")}
        onChange={(event) => {
          const picked = event.target.files?.[0];
          // Cleared so that choosing the same file again is a change again.
          event.target.value = "";
          if (picked) onFile(picked);
        }}
      />

      {file ? (
        <div className="flex items-center gap-3 rounded-xl bg-wash-1 p-3 ring-1 ring-border">
          <Tile />
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-xs break-all">
              {file.name}
            </span>
            <span className="block text-xs text-muted-foreground">
              {formatBytes(file.size, numbers)}
            </span>
          </span>
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={choose}
            disabled={disabled}
          >
            {t("restore.chooseOther")}
          </Button>
        </div>
      ) : (
        <div
          className={cn(
            "flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-5.5 text-center transition-colors",
            over ? "border-ring bg-wash-1" : "border-input",
          )}
        >
          <FileUp aria-hidden="true" className="size-5 text-muted-foreground" />
          <Button
            type="button"
            variant="outline"
            onClick={choose}
            disabled={disabled}
          >
            {t("restore.chooseFile")}
          </Button>
          <span className="text-xs text-muted-foreground">
            {t("restore.dropHint")}
          </span>
        </div>
      )}
    </div>
  );
}

function Tile() {
  return (
    <span
      aria-hidden="true"
      className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-wash-3 text-foreground"
    >
      <FileLock className="size-4" />
    </span>
  );
}
