"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  CONTRAST_CHOICES,
  DARK_SURFACES,
  LIGHT_SURFACES,
  swatchCss,
  type ContrastChoice,
  type SurfacePreferences,
} from "@/modules/profile/surface";
import { setSurfaceAction } from "@/modules/profile/actions";
import { ChoiceCard } from "./choice-card";
import { SwatchCards } from "./swatch-cards";
import { ThemeCards, type ThemeChoice } from "./theme-cards";

/**
 * How the page is lit: the theme, the surface behind each half of it, and
 * how much contrast.
 *
 * The theme lives in the browser: `next-themes` owns it, writes it to local
 * storage and applies it before paint. Nothing is sent anywhere, so nothing
 * can fail and there is no toast — the ring moving, and the page changing
 * colour under it, is the confirmation.
 *
 * The surfaces and the contrast are cookies, so the server can write them
 * onto `<html>` before the first paint. Like the accent, each is painted
 * before it is written — the attribute goes on the document root, the page
 * changes under the finger, and the action follows; a refused write takes
 * the attribute back rather than leaving the page lit a way the cookie does
 * not say. "Auto" contrast is the absence of the attribute plus whatever the
 * system asks for, which is what the pre-paint script would have done.
 */
const subscribeToNothing = () => () => {};

export function SurfaceChoices({ current }: { current: SurfacePreferences }) {
  const t = useTranslations("userSettings");
  const { theme, setTheme } = useTheme();
  const [chosen, setChosen] = useState(current);
  const [, startTransition] = useTransition();

  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const choose = (patch: Partial<SurfacePreferences>) => {
    const previous = chosen;
    const next = { ...chosen, ...patch };
    setChosen(next);
    paint(next);
    startTransition(async () => {
      const result = await setSurfaceAction(patch);
      if (!result.ok) {
        setChosen(previous);
        paint(previous);
        toast.error(result.error ?? t("surfaceFailed"));
      }
    });
  };

  const surfaceHelp = (surface: string) =>
    t(`surfaceHelp.${surface}` as Parameters<typeof t>[0]);

  return (
    <>
      <ThemeCards
        label={t("theme")}
        // Before the provider has read storage the choice is unknown. Ringing
        // "Auto" would be a guess that marks the wrong card for anybody who
        // chose otherwise, so nothing is ringed until it is known.
        value={mounted ? ((theme ?? "system") as ThemeChoice) : null}
        choices={{
          system: {
            label: t("themeSystem"),
            description: t("themeSystemHelp"),
          },
          light: {
            label: t("themeLight"),
            description: surfaceHelp(chosen.light),
          },
          dark: {
            label: t("themeDark"),
            description: surfaceHelp(chosen.dark),
          },
        }}
        surfaces={chosen}
        onChoose={(next) => setTheme(next)}
        disabled={!mounted}
      />

      <SwatchCards
        name="light-surface"
        label={t("surfaceLight")}
        value={chosen.light}
        columns={2}
        items={LIGHT_SURFACES.map((surface) => ({
          value: surface,
          label: t(`surfaces.${surface}`),
          description: surfaceHelp(surface),
          ...swatchCss(surface),
        }))}
        onChoose={(light) => choose({ light })}
      />

      <SwatchCards
        name="dark-surface"
        label={t("surfaceDark")}
        value={chosen.dark}
        columns={2}
        items={DARK_SURFACES.map((surface) => ({
          value: surface,
          label: t(`surfaces.${surface}`),
          description: surfaceHelp(surface),
          ...swatchCss(surface),
        }))}
        onChoose={(dark) => choose({ dark })}
      />

      <ChoiceCard
        name="contrast"
        label={t("contrast")}
        value={chosen.contrast}
        choices={CONTRAST_CHOICES.map((contrast) => ({
          value: contrast,
          label: t(`contrasts.${contrast}`),
          description: contrastHelp(t, contrast),
        }))}
        onChoose={(contrast) => choose({ contrast })}
      />

      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("contrastNote")}
      </p>
    </>
  );
}

function contrastHelp(
  t: ReturnType<typeof useTranslations<"userSettings">>,
  contrast: ContrastChoice,
): string | undefined {
  if (contrast === "auto") return t("contrastAutoHelp");
  if (contrast === "more") return t("contrastMoreHelp");
  return undefined;
}

/**
 * Puts the choice on the document root, the way the server would have.
 *
 * Defaults remove their attribute rather than naming themselves, so the
 * document ends up exactly as a fresh render would leave it. "Auto" then
 * asks the system, which is the pre-paint script's job on a page load.
 */
function paint(preferences: SurfacePreferences) {
  const root = document.documentElement;
  const set = (name: string, value: string, fallback: string) => {
    if (value === fallback) root.removeAttribute(name);
    else root.setAttribute(name, value);
  };
  set("data-light", preferences.light, "cream");
  set("data-dark", preferences.dark, "plum");
  if (preferences.contrast === "auto") {
    root.removeAttribute("data-contrast");
    if (window.matchMedia("(prefers-contrast: more)").matches) {
      root.setAttribute("data-contrast", "more");
    }
  } else {
    root.setAttribute("data-contrast", preferences.contrast);
  }
}
