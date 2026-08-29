"use client";

import { useSyncExternalStore } from "react";
import { NextIntlClientProvider } from "next-intl";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OfflineGroups } from "@/components/offline/offline-groups";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import {
  DEFAULT_LOCALE,
  isAppLocale,
  LOCALE_COOKIE_NAME,
  type AppLocale,
} from "@/i18n/locales";

/**
 * The offline shell's text, chosen in the browser rather than on the server.
 *
 * This page is precached at build time as a single static HTML file (see
 * `serwist.config.mjs`) and is served by the service worker when there is no
 * network at all. It therefore cannot ask the server which locale to use, and
 * cannot be a dynamic route without dropping out of the precache entirely.
 *
 * So both catalogues are bundled here and the locale cookie is read in the
 * browser. The server snapshot is the default locale and the client snapshot
 * is the cookie, so the prerendered HTML and the first client render agree and
 * React swaps in the real language after hydration — no mismatch, and the
 * brief flash is the price of a fallback that works with the network off.
 *
 * The catalogue chosen here is then handed to a nested provider, because what
 * this screen offers below the message is the whole entry form, and a form
 * speaking a language nobody chose is worse than a heading that does. The
 * whole catalogue was already in this chunk — these two imports pull both
 * files in their entirety for the sake of one object each — so the provider
 * costs nothing that was not already being paid.
 */

const CATALOGUES: Record<AppLocale, typeof en> = { en, fr };

function readLocaleCookie(): AppLocale {
  const match = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${LOCALE_COOKIE_NAME}=`));
  const value = match?.slice(LOCALE_COOKIE_NAME.length + 1);
  return isAppLocale(value) ? value : DEFAULT_LOCALE;
}

/** The cookie is read once at hydration; nothing changes it while on screen. */
const subscribeToNothing = () => () => {};

export function OfflineNotice() {
  const locale = useSyncExternalStore(
    subscribeToNothing,
    readLocaleCookie,
    () => DEFAULT_LOCALE,
  );

  const catalogue = CATALOGUES[locale];
  const messages = catalogue.offline;

  return (
    <div className="max-w-md space-y-6 text-center">
      <div className="space-y-4">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <WifiOff aria-hidden="true" className="size-6" />
        </span>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {messages.title}
        </h1>
        <p className="text-pretty text-muted-foreground">{messages.body}</p>
        <p className="text-sm text-pretty text-muted-foreground">
          {messages.note}
        </p>
        <Button onClick={() => window.location.reload()}>
          <RefreshCw aria-hidden="true" />
          {messages.retry}
        </Button>
      </div>

      {/*
       * Below the message, the part that is not a dead end: the groups this
       * device can still record an expense against. The nested provider gives
       * the form inside it the language picked above — the outer one carries
       * the default locale this page was prerendered in, and cannot know
       * better, having been built with no request to read.
       */}
      <NextIntlClientProvider locale={locale} messages={catalogue}>
        <OfflineGroups messages={messages} />
      </NextIntlClientProvider>
    </div>
  );
}
