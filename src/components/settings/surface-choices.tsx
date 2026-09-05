"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import {
  DARK_SURFACES,
  swatchCss,
  type SurfacePreferences,
} from "@/modules/profile/surface";
import { setSurfaceAction } from "@/modules/profile/actions";
import { SwatchCards } from "./swatch-cards";
import { ThemeCards, type ThemeChoice } from "./theme-cards";

/**
 * How the page is lit: the theme, and which of the two dark palettes sits
 * behind it.
 *
 * The theme lives in the browser: `next-themes` owns it, writes it to local
 * storage and applies it before paint. Nothing is sent anywhere, so nothing
 * can fail and there is no toast — the ring moving, and the page changing
 * colour under it, is the confirmation.
 *
 * The dark surface is a cookie, so the server can write it onto `<html>`
 * before the first paint. Like the accent, it is painted before it is
 * written — the attribute goes on the document root, the page changes under
 * the finger, and the action follows; a refused write takes the attribute
 * back rather than leaving the page lit a way the cookie does not say.
 *
 * Two controls used to live here as well. A light surface, Cream or Paper,
 * which was a preference with nothing behind it; and a contrast choice,
 * which was a worse copy of a setting the reader already has at the system
 * level. Increased contrast now follows `prefers-contrast: more` from a media
 * query in `globals.css` — no cookie, no pre-paint script, and no way for the
 * page to disagree with the platform.
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
            description: surfaceHelp("cream"),
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

      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("surfaceNote")}
      </p>
    </>
  );
}

/**
 * Puts the choice on the document root, the way the server would have.
 *
 * The default removes its attribute rather than naming itself, so the
 * document ends up exactly as a fresh render would leave it.
 */
function paint(preferences: SurfacePreferences) {
  const root = document.documentElement;
  if (preferences.dark === "plum") root.removeAttribute("data-dark");
  else root.setAttribute("data-dark", preferences.dark);
}
