"use client";

import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { RouteError } from "@/components/layout/route-error";

/**
 * Application error boundary.
 *
 * The screen of last resort below the root layout, so it owns the whole
 * viewport and offers the way home. A failure inside a group or inside
 * settings is caught nearer to where it happened, by the boundaries in those
 * segments, and keeps their chrome; one in the root layout itself is
 * `global-error.tsx`'s.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("errorBoundary");

  return (
    <RouteError error={error} retry={retry} className="min-h-dvh">
      <Button variant="outline" asChild>
        <a href="/dashboard">{t("goToGroups")}</a>
      </Button>
    </RouteError>
  );
}
