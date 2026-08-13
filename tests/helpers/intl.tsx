import type { ReactElement, ReactNode } from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import en from "../../messages/en.json";
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
 */
const CATALOGUES: Record<AppLocale, Record<string, unknown>> = { en, fr };

export function renderWithIntl(
  ui: ReactElement,
  options: RenderOptions & { locale?: AppLocale } = {},
) {
  const { locale = DEFAULT_LOCALE, ...renderOptions } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider
        locale={locale}
        messages={CATALOGUES[locale]}
        timeZone="UTC"
      >
        {children}
      </NextIntlClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}
