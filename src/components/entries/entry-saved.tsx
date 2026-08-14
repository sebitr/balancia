"use client";

import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConfirmationKey } from "./entry-logic";

/**
 * What just happened, and what to do next.
 *
 * A screen rather than a toast, because the two things people do after adding
 * an expense are add another one and go look at the group — and on a phone,
 * chasing a toast that is already fading is a worse way to offer either.
 *
 * "Add another" is primary: entries arrive in batches far more often than
 * alone, and the person who just split a dinner usually has the taxi next.
 */

export function EntrySaved({
  titleKey,
  summary,
  onAddAnother,
  onBackToGroup,
}: {
  titleKey: ConfirmationKey;
  /** One line: what was saved, for how much, and how often if it repeats. */
  summary: string;
  onAddAnother: () => void;
  onBackToGroup: () => void;
}) {
  const t = useTranslations("addEntry.saved");

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-positive/15">
        <Check aria-hidden="true" className="size-8 text-positive" />
      </span>

      <div className="space-y-1.5">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em]">
          {t(titleKey)}
        </h1>
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>

      <div className="flex w-full max-w-xs flex-col gap-2.5">
        <Button type="button" size="lg" className="h-13" onClick={onAddAnother}>
          {t("addAnother")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="h-13"
          onClick={onBackToGroup}
        >
          {t("backToGroup")}
        </Button>
      </div>
    </div>
  );
}
