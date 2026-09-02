"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";

/**
 * Client-side providers.
 *
 * TanStack Query is here only for the few client workflows that genuinely
 * benefit from cache management — currently passkey management, whose list
 * changes in response to a browser-only WebAuthn ceremony. Page data is loaded
 * by Server Components, not fetched here.
 */
export function Providers({
  children,
  nonce,
}: {
  children: ReactNode;
  /**
   * The request's Content Security Policy nonce.
   *
   * next-themes paints the stored theme before hydration with an inline
   * script, and `proxy.ts` only lets an inline script run when it carries the
   * nonce of the response it arrived in. Without this the browser refuses the
   * script, logs a policy violation on every page, and a reader who chose dark
   * sees the light ground until React has loaded — a frame on a fast machine,
   * most of a second on a phone fetching the bundle over a slow connection.
   */
  nonce?: string;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Not the default "theme" key: `react-theme-switch-animation` writes
      // `localStorage.theme` itself on every switch, which would overwrite the
      // provider's record — losing a "system" preference in particular.
      storageKey="balancia-theme"
      nonce={nonce}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
