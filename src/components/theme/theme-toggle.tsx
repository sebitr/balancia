"use client";

import { useRef, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useModeAnimation } from "react-theme-switch-animation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** The three the settings screen offers, in the order it offers them. */
const CHOICES = ["system", "light", "dark"] as const;

type ThemeChoice = (typeof CHOICES)[number];

/**
 * The theme picker in the app header, with a circular reveal on the switch.
 *
 * Three choices rather than two. A plain toggle can only ever hold light and
 * dark, so the first tap on it threw away "follow my device" with no way back
 * to it short of the settings screen — and on a phone that is where the
 * preference came from in the first place.
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
        aria-label={t("menu")}
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
  const tSettings = useTranslations("userSettings");
  const { theme, systemTheme, resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const active: ThemeChoice = isThemeChoice(theme) ? theme : "system";

  /**
   * The choice the running animation belongs to.
   *
   * The hook deals in a boolean, so left to itself `onDarkModeChange` would
   * write back "light" or "dark" — and picking "Auto" would stop following the
   * device the moment the reveal finished. The choice is stashed here on the
   * way in and written back on the way out instead.
   */
  const pending = useRef<ThemeChoice | null>(null);

  const { ref, toggleSwitchTheme } = useModeAnimation({
    isDarkMode: isDark,
    onDarkModeChange: (next) => {
      setTheme(pending.current ?? (next ? "dark" : "light"));
      pending.current = null;
    },
  });

  const labels: Record<ThemeChoice, string> = {
    system: tSettings("themeSystem"),
    light: tSettings("themeLight"),
    dark: tSettings("themeDark"),
  };

  const choose = (next: ThemeChoice) => {
    if (next === active) return;
    // Only a switch the eye can see is worth a reveal. Choosing "Auto" on a
    // device already showing what "Auto" resolves to changes the preference
    // and nothing else, and animating it would wipe the screen for no reason.
    if (resolveChoice(next, systemTheme) === resolvedTheme) {
      setTheme(next);
      return;
    }
    pending.current = next;
    void toggleSwitchTheme();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon"
          className={className}
          aria-label={`${t("menu")}: ${labels[active]}`}
        >
          {isDark ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuRadioGroup
          value={active}
          onValueChange={(next) => {
            if (isThemeChoice(next)) choose(next);
          }}
        >
          {CHOICES.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice}>
              {labels[choice]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isThemeChoice(value: string | undefined): value is ThemeChoice {
  return CHOICES.includes(value as ThemeChoice);
}

/** What a choice will actually paint, so a no-op switch can be spotted. */
function resolveChoice(
  choice: ThemeChoice,
  systemTheme: string | undefined,
): string | undefined {
  return choice === "system" ? systemTheme : choice;
}
