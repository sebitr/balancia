"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, ChevronDown, Languages } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setLocaleAction } from "@/i18n/actions";
import {
  DEFAULT_LOCALE,
  isAppLocale,
  LOCALES,
  LOCALE_LABELS,
  type AppLocale,
} from "@/i18n/locales";

const LOCALE_FLAGS: Record<AppLocale, string> = {
  en: "🇬🇧",
  fr: "🇫🇷",
};

function useLanguageChoice() {
  const router = useRouter();
  const requestedLocale = useLocale();
  const activeLocale = isAppLocale(requestedLocale)
    ? requestedLocale
    : DEFAULT_LOCALE;
  const [isPending, startTransition] = useTransition();

  const choose = (locale: AppLocale) => {
    if (locale === activeLocale) return;
    startTransition(async () => {
      await setLocaleAction(locale);
      router.refresh();
    });
  };

  return { activeLocale, choose, isPending };
}

/**
 * Language choices for the account dropdown.
 *
 * Rendered as menu items rather than a nested select so the whole list is one
 * tap away on a phone — with two languages, a submenu would be more work than
 * the choice deserves.
 *
 * Every visible string on the page comes from the server render, so after the
 * cookie is written the router is refreshed to re-render in the new language.
 */
export function LanguageMenuItems() {
  const t = useTranslations("nav");
  const { activeLocale, choose, isPending } = useLanguageChoice();

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-2 text-xs font-normal text-muted-foreground">
        <Languages aria-hidden="true" className="size-3.5" />
        {t("language")}
      </DropdownMenuLabel>
      {LOCALES.map((locale) => {
        const isActive = locale === activeLocale;
        return (
          <DropdownMenuItem
            key={locale}
            disabled={isPending}
            // The menu would otherwise close before the action is sent.
            onSelect={(event) => {
              event.preventDefault();
              choose(locale);
            }}
            aria-current={isActive ? "true" : undefined}
          >
            <Check
              aria-hidden="true"
              className={isActive ? "opacity-100" : "opacity-0"}
            />
            {LOCALE_LABELS[locale]}
          </DropdownMenuItem>
        );
      })}
    </>
  );
}

/**
 * A public language picker for the marketing header.
 *
 * The current choice stays visible at phone widths, where a generic globe
 * would make the visitor open the menu just to learn which language is active.
 * Language names are written in their own language so they remain recognisable
 * even when the rest of the page is not.
 */
export function MarketingLanguageSwitcher() {
  const t = useTranslations("nav");
  const { activeLocale, choose, isPending } = useLanguageChoice();
  const activeLabel = LOCALE_LABELS[activeLocale];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`${t("language")}: ${activeLabel}`}
        className="group inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-white/20 px-2.5 text-sm font-semibold text-marketing-cream transition-colors hover:bg-white/9 data-open:bg-white/9"
      >
        <span aria-hidden="true" className="text-sm leading-none">
          {LOCALE_FLAGS[activeLocale]}
        </span>
        <span>{activeLocale.toUpperCase()}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-3.5 opacity-65 transition-transform group-data-open:rotate-180"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={7}
        aria-label={t("language")}
        className="w-44 rounded-xl bg-marketing-cream p-1.5 text-marketing-plum shadow-xl ring-marketing-plum/12"
      >
        {LOCALES.map((locale) => {
          const isActive = locale === activeLocale;
          return (
            <DropdownMenuItem
              key={locale}
              disabled={isPending}
              onSelect={() => choose(locale)}
              aria-current={isActive ? "true" : undefined}
              className="gap-2 rounded-lg px-2.5 py-2 text-sm focus:bg-marketing-cream-deep focus:text-marketing-plum"
            >
              <span aria-hidden="true" className="text-base leading-none">
                {LOCALE_FLAGS[locale]}
              </span>
              <span className={isActive ? "font-semibold" : undefined}>
                {LOCALE_LABELS[locale]}
              </span>
              <Check
                aria-hidden="true"
                className={`ml-auto size-4 text-primary ${isActive ? "opacity-100" : "opacity-0"}`}
              />
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
