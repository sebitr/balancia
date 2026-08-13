import type { Metadata, Viewport } from "next";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "@/components/ui/sonner";
import { SerwistRegister } from "@/components/pwa/serwist-register";
import { Providers } from "@/components/providers";
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

export const metadata: Metadata = {
  title: {
    default: "Balancia",
    template: "%s · Balancia",
  },
  description:
    "Privacy-focused, self-hosted shared expense tracking. Shared expenses. Fairly balanced.",
  applicationName: "Balancia",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Balancia",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7f1" },
    { media: "(prefers-color-scheme: dark)", color: "#2a0e31" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      // The theme provider's pre-paint script sets `class` and `style` on this
      // element before React hydrates, which is a mismatch by construction.
      suppressHydrationWarning
      className={`${instrumentSans.variable} ${instrumentSerif.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <SerwistRegister />
        <Providers>{children}</Providers>
        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
