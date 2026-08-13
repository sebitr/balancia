"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useModeAnimation } from "react-theme-switch-animation";
import { Button } from "@/components/ui/button";

/**
 * Light/dark switch with a circular reveal centred on the button.
 *
 * `next-themes` owns the preference (storage, system tracking, the pre-paint
 * script that stops the wrong palette flashing on load). `useModeAnimation`
 * only drives the View Transition and reports the new value back through
 * `onDarkModeChange`, so the two never disagree about what "dark" means.
 *
 * The hook degrades on its own: browsers without `startViewTransition`, and
 * anyone who asked for reduced motion, get an instant switch instead.
 */
/**
 * Never changes after hydration, so there is nothing to subscribe to — the
 * client/server snapshot pair below is only being used to detect that
 * hydration has happened.
 */
const subscribeToNothing = () => () => {};

export function ThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  // Before the provider has read storage the resolved theme is unknown, and
  // the hook syncs `<html>` to whatever it is handed — on a dark page that
  // would strip the class and flash white for a frame. Hold an inert button of
  // the same size until the real value is available.
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="icon"
        className={className}
        aria-label={t("toggle")}
        disabled
      >
        <Sun aria-hidden="true" />
      </Button>
    );
  }

  return <AnimatedThemeToggle className={className} />;
}

function AnimatedThemeToggle({ className }: { className?: string }) {
  const t = useTranslations("theme");
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const { ref, toggleSwitchTheme } = useModeAnimation({
    isDarkMode: isDark,
    onDarkModeChange: (next) => setTheme(next ? "dark" : "light"),
  });

  return (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={className}
      aria-label={isDark ? t("toLight") : t("toDark")}
      onClick={() => void toggleSwitchTheme()}
    >
      {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
    </Button>
  );
}
