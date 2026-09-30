"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { RouteError } from "@/components/layout/route-error";

/**
 * A settings screen that could not be drawn.
 *
 * Drawn on the settings surface, header and all, rather than as the root
 * boundary's page of its own: settings has no app header to fall back on, so
 * the header here *is* the way out. It is the one the failed screen would
 * have had — the hub's ✕, or a detail screen's way back to the hub — so a
 * reader who came to change one thing leaves the way they would have.
 */
export default function SettingsError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations("userSettings");
  const tError = useTranslations("errorBoundary");
  const hub = usePathname() === "/settings";

  return (
    <SettingsScreen
      title={tError("title")}
      {...(hub
        ? { close: { href: "/dashboard", label: t("close") } }
        : { back: { href: "/settings", label: t("backToSettings") } })}
    >
      <RouteError
        error={error}
        retry={retry}
        titled={false}
        className="py-16"
      />
    </SettingsScreen>
  );
}
