import { cn } from "@/lib/utils";
import type { BackupProvider } from "@/modules/backup/providers";

/**
 * The mark beside a provider's name: a tile with two letters in it.
 *
 * Monograms, not logos. A logo is somebody's trademark and comes with rules
 * about colour, clear space and what it may sit next to; two letters on the
 * neutral wash say which provider this is without any of that, and look the
 * same in light and dark. If the project ever takes the brand rules on, this is
 * the one place that changes.
 *
 * Decorative: the provider's name is always written beside it, so the tile is
 * hidden from assistive technology.
 */

/** Infomaniak is a choice of service in the wizard rather than a provider. */
export type ProviderChoice = BackupProvider | "infomaniak";

const MONOGRAMS: Readonly<Record<ProviderChoice, string>> = {
  google_drive: "GD",
  dropbox: "Db",
  onedrive: "OD",
  infomaniak: "Ik",
  webdav: "WD",
  s3: "S3",
  proton_drive: "Pr",
  icloud_drive: "iC",
};

export function ProviderMark({
  provider,
  size = "md",
  className,
}: {
  provider: ProviderChoice;
  /** 36px, or 44px where the mark leads a card. */
  size?: "md" | "lg";
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl bg-wash-3 font-semibold text-foreground",
        size === "lg" ? "size-11 text-sm" : "size-9 text-xs",
        className,
      )}
    >
      {MONOGRAMS[provider]}
    </span>
  );
}
