import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { NextIntlClientProvider } from "next-intl";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { FormatPreferencesProvider } from "@/i18n/format-context";
import {
  resolveAccentColor,
  resolveFormatPreferences,
  resolveSurfacePreferences,
} from "@/i18n/preferences";
import { CurrencyFavoritesProvider } from "@/components/money/currency-favorites";
import { resolveCurrencyFavorites } from "@/modules/currencies/preferences";
import { accentTokens } from "@/modules/profile/accent";
import {
  CONTRAST_PREPAINT_SCRIPT,
  surfaceAttributes,
  themeColorFor,
} from "@/modules/profile/surface";
import { ContrastFollower } from "@/components/theme/contrast-follower";
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

/**
 * The browser chrome is tinted with the page's own ground, so it follows
 * the surface the reader chose: paper white rather than cream, near-black
 * rather than plum. Which of the two applies is the system's call, as it
 * was before — the theme itself is settled in the browser, after this.
 */
export async function generateViewport(): Promise<Viewport> {
  const surfaces = await resolveSurfacePreferences();
  return {
    themeColor: [
      {
        media: "(prefers-color-scheme: light)",
        color: themeColorFor(surfaces.light),
      },
      {
        media: "(prefers-color-scheme: dark)",
        color: themeColorFor(surfaces.dark),
      },
    ],
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };
}

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
  // The surfaces and the contrast choice, as attributes on the same element,
  // where the override blocks in globals.css look for them.
  const surfaces = await resolveSurfacePreferences();
  // Two inline scripts run before paint — the theme provider's and the
  // contrast one below — and under the strict CSP both need the nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang={locale}
      // The theme provider's pre-paint script sets `class` and `style` on this
      // element before React hydrates, and the contrast script may set
      // `data-contrast` — a mismatch by construction.
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${GeistMono.variable} h-full antialiased`}
      style={accentTokens(accent)}
      {...surfaceAttributes(surfaces)}
    >
      <body className="flex min-h-full flex-col">
        {/* First thing in the body, so it has run before anything below is
            laid out — the same place the theme provider's script goes. */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: CONTRAST_PREPAINT_SCRIPT }}
        />
        <ContrastFollower choice={surfaces.contrast} />
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
