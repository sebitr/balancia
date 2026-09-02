import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { FormatPreferencesProvider } from "@/i18n/format-context";
import {
  resolveAccentColor,
  resolveFormatPreferences,
} from "@/i18n/preferences";
import { CurrencyFavoritesProvider } from "@/components/money/currency-favorites";
import { resolveCurrencyFavorites } from "@/modules/currencies/preferences";
import { accentTokens } from "@/modules/profile/accent";
import { getEnv } from "@/lib/env";
import { Toaster } from "@/components/ui/sonner";
import { SerwistRegister } from "@/components/pwa/serwist-register";
import { Providers } from "@/components/providers";
import { SwipeBack } from "@/components/motion/swipe-back";
import "./globals.css";

/** Interface, headings and amounts. */
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument-sans",
  display: "swap",
});

/** Editorial voice — marketing surfaces only, never inside the product. */
const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  const env = getEnv();
  return {
    metadataBase: new URL(env.appOrigin),
    title: {
      default: "Balancia",
      template: "%s · Balancia",
    },
    description: t("description"),
    applicationName: "Balancia",
    manifest: "/manifest.webmanifest",
    robots: {
      index: false,
      follow: false,
      noarchive: true,
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Balancia",
    },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7f1" },
    { media: "(prefers-color-scheme: dark)", color: "#2a0e31" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Resolved from the locale cookie, falling back to Accept-Language.
  const locale = await getLocale();
  // Dates and numbers are written the way this reader writes them, which is a
  // separate choice from the language above.
  const formats = await resolveFormatPreferences();
  // Starred currencies, for every picker below. One value per reader, so it is
  // resolved here rather than in each of the seven forms that opens one.
  const favorites = await resolveCurrencyFavorites();
  // The accent, painted onto the root element in the server's own HTML. An
  // inline declaration outranks both `:root` and `.dark`, so the three tokens
  // it sets are the ones every accent in the app reads.
  const accent = await resolveAccentColor();
  // The policy nonce `proxy.ts` minted for this response. The theme provider
  // paints the stored theme with an inline script before React runs, and only
  // a script carrying this nonce is allowed to; see `Providers`.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={locale}
      // The theme provider's pre-paint script sets `class` and `style` on this
      // element before React hydrates, which is a mismatch by construction.
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${GeistMono.variable} h-full antialiased`}
      style={accentTokens(accent)}
    >
      <body className="flex min-h-full flex-col">
        <SerwistRegister />
        {/* Locale and messages are inherited from the server render; Client
            Components below can call useTranslations without prop drilling. */}
        <NextIntlClientProvider>
          {/* Only what the browser needs: the resolved number locale is
              derived from these, so sending it too would be sending the same
              choice twice. */}
          <FormatPreferencesProvider
            value={{
              dateFormat: formats.dateFormat,
              numberFormat: formats.numberFormat,
              formatLocale: formats.formatLocale,
              timeZone: formats.timeZone,
            }}
          >
            <CurrencyFavoritesProvider
              initial={favorites.favorites}
              persist={favorites.persist}
            >
              <Providers nonce={nonce}>{children}</Providers>
            </CurrencyFavoritesProvider>
            {/* Above every shell, not inside one: the gesture counts how many
                of our own screens are behind this one, and moving between a
                group and the home screen swaps one shell for the other.
                Mounted in there, it would forget its way back on the way in. */}
            <SwipeBack />
            <Toaster />
          </FormatPreferencesProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
