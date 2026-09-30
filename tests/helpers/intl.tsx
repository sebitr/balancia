import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider, type Messages } from "next-intl";
import en from "../../messages/en.json";
import { clientMessages, type MessageArea } from "@/i18n/client-messages";
import { DEFAULT_LOCALE, type AppLocale } from "@/i18n/locales";
import fr from "../../messages/fr.json";

/**
 * Renders a component with the real message catalogue in place.
 *
 * Component tests assert on the strings a person actually sees, so they run
 * against the shipped catalogue rather than a stub — a key deleted from
 * `messages/en.json` should fail the test that depends on it.
 *
 * In the app this provider is fed by the server render; in jsdom there is no
 * server, so locale and messages are supplied explicitly here.
 *
 * By default the provider carries the whole catalogue, which is more than any
 * screen in the app is handed. `area` narrows it to what that area's provider
 * carries — `clientMessages`, the same pick `AreaMessages` makes — so that a
 * component asking for a namespace its area leaves out prints the key here
 * too, rather than only in the browser. `AreaMessages` itself cannot be
 * mounted in jsdom: it relies on the server's provider to fill in the locale.
 */
const CATALOGUES: Record<AppLocale, Record<string, unknown>> = { en, fr };

export function renderWithIntl(
  ui: ReactElement,
  options: RenderOptions & { locale?: AppLocale; area?: MessageArea } = {},
) {
  const { locale = DEFAULT_LOCALE, area, ...renderOptions } = options;
  const catalogue = CATALOGUES[locale];
  const messages = area
    ? clientMessages(catalogue as unknown as Messages, area)
    : catalogue;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={messages}
        timeZone="UTC"
      >
        {children}
      </NextIntlClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
