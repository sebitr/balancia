"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Application error boundary.
 *
 * Shows a plain message and a way out. The underlying error is logged to the
 * browser console for a developer, never rendered — a stack trace on screen
 * can leak internals.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errorBoundary");
  const tCommon = useTranslations("common");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        {t("title")}
      </h1>
      <p className="max-w-md text-pretty text-muted-foreground">{t("body")}</p>
      {error.digest && (
        <p className="font-mono text-xs text-muted-foreground">
          {t("reference", { digest: error.digest })}
        </p>
      )}
      <div className="flex gap-3">
        <Button onClick={reset}>{tCommon("retry")}</Button>
        <Button variant="outline" asChild>
          <a href="/dashboard">{t("goToGroups")}</a>
        </Button>
      </div>
    </div>
  );
}
