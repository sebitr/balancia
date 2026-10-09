"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Copy } from "lucide-react";
import { SettingsCard } from "@/components/settings/settings-card";
import { Button } from "@/components/ui/button";

/** How long "Copied" stays before the button offers to copy again. */
const COPIED_MS = 2500;

/**
 * The way out that does not need Balancia.
 *
 * Always on the screen, opened backup or not: the point of choosing age is
 * that a backup is still readable the day this server is gone, and the place
 * to say so is the screen somebody uses on that day. One command, a
 * copy button, and the one thing the command does not cover: receipts are
 * separate files and are put back by hand.
 */
export function DecryptYourselfCard() {
  const t = useTranslations("cloudBackup");
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(t("restore.selfCommand"));
    } catch {
      // A browser that refuses the clipboard leaves the command on the screen,
      // selectable, which is the fallback and not an error worth a toast.
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  return (
    <SettingsCard
      title={t("restore.selfTitle")}
      description={t("restore.selfBody")}
    >
      <div className="space-y-3">
        <code
          // Selectable in one press, for the browser that will not give a
          // script the clipboard.
          className="block rounded-[10px] bg-muted px-3 py-2.5 font-mono text-xs leading-relaxed break-all select-all"
        >
          {t("restore.selfCommand")}
        </code>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void copy()}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? t("key.copied") : t("key.copy")}
        </Button>
        <p className="text-xs text-pretty text-muted-foreground">
          {t("restore.receiptsNote")}
        </p>
      </div>
    </SettingsCard>
  );
}
