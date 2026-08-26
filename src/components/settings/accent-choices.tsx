"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Check } from "lucide-react";
import { toast } from "sonner";
import {
  ACCENT_COLORS,
  ACCENT_VALUES,
  accentTokens,
  type AccentColor,
} from "@/modules/profile/accent";
import { setAccentColorAction } from "@/modules/profile/actions";

/**
 * Seven colours, as the thing they colour.
 *
 * No caption under each swatch: a round of colour is its own name, and seven
 * labels in a row at this size would be seven pieces of text nobody reads. The
 * chosen one names itself once, beside the section label, which is where
 * somebody looks to find out what they just picked.
 *
 * **Painted before it is written.** The accent reaches the app as `--primary`
 * on the document root, and the server puts it there on the next render — but
 * the tap has to recolour the tick that just moved, along with every other
 * accent on screen. So the tokens are set on `documentElement` first and the
 * action follows; a refused write puts both back rather than leaving the app a
 * colour the account did not keep.
 *
 * No toast either. Everything accent-coloured on screen has already changed,
 * which says more than a line of text can, and the way back is the swatch
 * still sitting right there.
 */
export function AccentChoices({ current }: { current: AccentColor }) {
  const t = useTranslations("userSettings");
  const [chosen, setChosen] = useState<AccentColor>(current);
  const [, startTransition] = useTransition();

  const paint = (accent: AccentColor) => {
    const style = document.documentElement.style;
    for (const [token, value] of Object.entries(accentTokens(accent))) {
      style.setProperty(token, value);
    }
  };

  const choose = (next: AccentColor) => {
    if (next === chosen) return;
    const previous = chosen;
    setChosen(next);
    paint(next);
    startTransition(async () => {
      const result = await setAccentColorAction(next);
      if (!result.ok) {
        setChosen(previous);
        paint(previous);
        toast.error(result.error ?? t("accentFailed"));
      }
    });
  };

  return (
    <section className="flex shrink-0 flex-col gap-2.25">
      <div className="flex items-baseline justify-between gap-3 px-1.5">
        <h2
          id="accent-label"
          className="text-2xs font-semibold tracking-[0.11em] text-muted-foreground uppercase"
        >
          {t("accent")}
        </h2>
        <span className="shrink-0 text-2xs text-muted-foreground">
          {t(`accents.${chosen}` as Parameters<typeof t>[0])}
        </span>
      </div>

      <RadioGroupPrimitive.Root
        aria-labelledby="accent-label"
        value={chosen}
        onValueChange={(next) => choose(next as AccentColor)}
        className="flex items-center justify-between gap-1.5 rounded-2xl bg-card px-3 py-3.5 ring-1 ring-foreground/10"
      >
        {ACCENT_COLORS.map((accent) => (
          <RadioGroupPrimitive.Item
            key={accent}
            value={accent}
            aria-label={t(`accents.${accent}` as Parameters<typeof t>[0])}
            className="group flex size-8.5 shrink-0 items-center justify-center rounded-full transition-shadow focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
            style={{
              background: ACCENT_VALUES[accent],
              // The inner gap is the card's own colour, so the ring reads as a
              // halo around the swatch rather than a second colour on it.
              boxShadow:
                chosen === accent
                  ? `0 0 0 2px var(--card), 0 0 0 4px ${ACCENT_VALUES[accent]}`
                  : undefined,
            }}
          >
            {/* Plum on all seven: every one sits between 0.70 and 0.78
                lightness, which is exactly why the palette stops there. */}
            <Check
              aria-hidden="true"
              className="size-3.5 text-[oklch(0.226_0.072_319)] opacity-0 group-data-[state=checked]:opacity-100"
              strokeWidth={3}
            />
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>

      <p className="px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("accentNote")}
      </p>
    </section>
  );
}
