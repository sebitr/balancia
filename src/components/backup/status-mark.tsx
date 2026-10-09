"use client";

import { useTranslations } from "next-intl";
import { Check, CircleAlert, CircleMinus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * What became of one run: an icon and a word, never a colour on its own.
 *
 * The three outcomes are told apart by shape and by name — a check for "Backed
 * up", a circle with a bar for "No changes", a circle with a mark for "Failed" —
 * so the row reads the same to someone who cannot tell the inks apart. A
 * success is drawn in the ordinary ink: green belongs to "somebody owes you"
 * and nothing here is about money. Only the failure takes the destructive ink,
 * which is the one colour in the app already spoken for as "this went wrong".
 */

export type RunStatus = "running" | "succeeded" | "unchanged" | "failed";

export function StatusMark({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  const t = useTranslations("cloudBackup");

  const { Icon, word, ink, spin } = {
    succeeded: {
      Icon: Check,
      word: t("overview.statusOk"),
      ink: "text-foreground",
      spin: false,
    },
    unchanged: {
      Icon: CircleMinus,
      word: t("overview.statusSkipped"),
      ink: "text-muted-foreground",
      spin: false,
    },
    failed: {
      Icon: CircleAlert,
      word: t("overview.statusFailed"),
      ink: "text-destructive",
      spin: false,
    },
    running: {
      Icon: Loader2,
      word: t("overview.runningNow"),
      ink: "text-muted-foreground",
      spin: true,
    },
  }[status];

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs font-medium whitespace-nowrap",
        ink,
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-3.5", spin && "motion-safe:animate-spin")}
        strokeWidth={2}
      />
      {word}
    </span>
  );
}
