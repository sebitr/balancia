"use client";

import { useSyncExternalStore } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
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
 */

const CATALOGUES: Record<AppLocale, { offline: typeof en.offline }> = {
  en,
  fr,
};

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

  const messages = CATALOGUES[locale].offline;

  return (
    <div className="max-w-md space-y-4 text-center">
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
  );
}
