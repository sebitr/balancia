"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { SheetTitle } from "@/components/ui/sheet";
import {
  GROUP_ICONS,
  GROUP_ICON_COLORS,
  type GroupIcon,
  type GroupIconColor,
} from "@/modules/groups/icons";
import { GROUP_ICON_GLYPHS, groupAccent } from "@/components/groups/group-icon";
import { cn } from "@/lib/utils";

/**
 * Choosing a group's icon and accent.
 *
 * The second view of the create sheet rather than a screen of its own: the
 * name field is repeated here and bound to the same state, so the two things
 * you are deciding between — what it is called and what it looks like — are
 * never on opposite sides of a navigation.
 *
 * Every choice applies immediately. There is nothing to confirm and so no
 * cancel: `Terminé` and the back arrow do the same thing.
 *
 * The catalogue below is provisional — see `@/modules/groups/icons`. Until it
 * settles, each tile is named by its slug rather than by translated copy.
 */
export function GroupIconPicker({
  name,
  onName,
  icon,
  color,
  onIcon,
  onColor,
  onBack,
}: {
  name: string;
  onName: (value: string) => void;
  icon: GroupIcon | null;
  color: GroupIconColor;
  onIcon: (icon: GroupIcon | null) => void;
  onColor: (color: GroupIconColor) => void;
  onBack: () => void;
}) {
  const t = useTranslations("groupForm");
  const tCommon = useTranslations("common");
  const accent = groupAccent(color);
  const Chosen = icon ? GROUP_ICON_GLYPHS[icon] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col motion-safe:animate-in motion-safe:duration-200 motion-safe:fade-in-0 motion-safe:slide-in-from-right-3">
      <header className="flex shrink-0 items-center gap-1 px-5 pt-2.5 pb-3.5">
        <button
          type="button"
          onClick={onBack}
          className="-ml-1.5 flex size-8 shrink-0 items-center justify-center rounded-full text-foreground transition-colors duration-150 hover:bg-foreground/8"
        >
          <ArrowLeft aria-hidden="true" className="size-[18px]" />
          <span className="sr-only">{tCommon("back")}</span>
        </button>
        <SheetTitle className="flex-1 text-lg font-semibold tracking-[-0.01em]">
          {t("iconTitle")}
        </SheetTitle>
        <button
          type="button"
          onClick={() => onIcon(null)}
          className="flex h-8 shrink-0 items-center rounded-full px-2.5 text-[13px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-foreground/6"
        >
          {t("iconNone")}
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[22px] overflow-y-auto px-5 pb-3">
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden="true"
            className="flex size-16 shrink-0 items-center justify-center rounded-[20px] bg-foreground/5"
            style={
              Chosen
                ? {
                    background: `color-mix(in oklch, ${accent} 20%, transparent)`,
                    color: accent,
                  }
                : undefined
            }
          >
            {Chosen ? (
              <Chosen
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="size-[30px]"
              />
            ) : (
              <span className="text-lg font-semibold text-muted-foreground">
                {name.trim().slice(0, 1).toUpperCase()}
              </span>
            )}
          </span>
          {/* The same state as the field on the form view: editing either
              edits the group's name. */}
          <input
            value={name}
            onChange={(event) => onName(event.target.value)}
            maxLength={120}
            autoComplete="off"
            aria-label={t("name")}
            placeholder={t("name")}
            className="h-11 min-w-0 flex-1 rounded-xl bg-transparent px-3.5 text-base font-semibold inset-ring inset-ring-foreground/10 outline-none placeholder:font-medium placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-primary/28 focus-visible:inset-ring-primary"
          />
        </div>

        <section className="flex flex-col gap-2.5">
          <span className="text-xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            {t("iconColorLabel")}
          </span>
          <div
            role="radiogroup"
            aria-label={t("iconColorLabel")}
            className="flex gap-2.5"
          >
            {GROUP_ICON_COLORS.map((swatch) => {
              const selected = swatch === color;
              return (
                <button
                  key={swatch}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={swatch}
                  onClick={() => onColor(swatch)}
                  className={cn(
                    "size-9 rounded-full transition-transform duration-150",
                    selected ? "scale-100" : "scale-[0.86]",
                  )}
                  style={{
                    background: groupAccent(swatch),
                    boxShadow: selected
                      ? `0 0 0 2px var(--card), 0 0 0 4px ${groupAccent(swatch)}`
                      : undefined,
                  }}
                />
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <span className="text-xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">
            {t("iconLabel")}
          </span>
          <div
            role="radiogroup"
            aria-label={t("iconLabel")}
            className="grid grid-cols-5 gap-2"
          >
            {GROUP_ICONS.map((slug) => {
              const Glyph = GROUP_ICON_GLYPHS[slug];
              const selected = slug === icon;
              return (
                <button
                  key={slug}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={slug}
                  onClick={() => onIcon(slug)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-[14px] transition-colors duration-150",
                    selected
                      ? ""
                      : "bg-foreground/5 text-foreground/85 inset-ring inset-ring-foreground/8",
                  )}
                  style={
                    selected
                      ? {
                          background: `color-mix(in oklch, ${accent} 18%, transparent)`,
                          boxShadow: `inset 0 0 0 1px ${accent}`,
                          color: accent,
                        }
                      : undefined
                  }
                >
                  <Glyph
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-[22px]"
                  />
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <footer className="shrink-0 bg-linear-to-t from-card from-62% to-transparent px-5 pt-3 pb-[22px]">
        <button
          type="button"
          onClick={onBack}
          className="h-[50px] w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground transition-[filter,translate] duration-150 hover:brightness-105 active:translate-y-px"
        >
          {t("done")}
        </button>
      </footer>
    </div>
  );
}
