"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Languages } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { setLocaleAction } from "@/i18n/actions";
import { LOCALES, LOCALE_LABELS, type AppLocale } from "@/i18n/locales";

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
  const router = useRouter();
  const activeLocale = useLocale();
  const t = useTranslations("nav");
  const [isPending, startTransition] = useTransition();

  const choose = (locale: AppLocale) => {
    if (locale === activeLocale) return;
    startTransition(async () => {
      await setLocaleAction(locale);
      router.refresh();
    });
  };

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
