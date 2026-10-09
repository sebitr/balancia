"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import type { ProviderChoice } from "@/components/backup/provider-mark";
import { errorCopy, type Translate } from "@/components/backup/error-copy";
import { PROVIDER_NAMES } from "@/modules/backup/providers";

/**
 * A refusal from the backup actions, worded.
 *
 * The server answers with a code and the provider's own scrubbed words; the
 * sentence is the reader's language's. Two kinds of code arrive here — the ten a
 * failed backup can record, and the five a request can be refused for — and the
 * table that words them is shared with the overview (`../error-copy.ts`), so a
 * failure reads the same on every screen that shows it.
 */

/** A brand name for a sentence: "Dropbox could not be reached." */
export function providerName(choice: ProviderChoice): string {
  return choice === "infomaniak" ? "Infomaniak" : PROVIDER_NAMES[choice];
}

export interface OutcomeText {
  readonly sentence: string;
  /** What to do about it, where the catalogue has a line for that. */
  readonly hint: string | null;
}

export function useOutcomeText(
  provider: string,
): (code: string | null | undefined) => OutcomeText {
  const t = useTranslations("cloudBackup");

  return useCallback(
    (code) => errorCopy(t as unknown as Translate, code, provider),
    [t, provider],
  );
}
