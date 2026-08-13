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
export function Providers({ children }: { children: ReactNode }) {
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
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ThemeProvider>
  );
}
