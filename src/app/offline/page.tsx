import type { Metadata } from "next";
import { Wordmark } from "@/components/brand/wordmark";
import { OfflineNotice } from "@/components/pwa/offline-notice";

/** English at build time; the shell relabels itself once mounted. */
export const metadata: Metadata = { title: "Offline" };

/**
 * Forces this route to prerender even though the root layout resolves the
 * locale from a cookie. Without it, that cookie read makes every route
 * dynamic, `server/app/offline.html` is never emitted, and the service worker
 * has nothing to precache — the offline fallback would silently stop working.
 *
 * Under `force-static`, `cookies()` returns empty at build time, so the shell
 * is baked in the default locale and `OfflineNotice` corrects the language in
 * the browser.
 */
export const dynamic = "force-static";

/**
 * Offline fallback shell.
 *
 * Static by design: it must render from the precache with no network and no
 * database, so it deliberately avoids every dynamic API — including the locale
 * cookie. `OfflineNotice` picks the language client-side instead. It says
 * plainly that Balancia does not accept offline entries in this version, so
 * nobody types an expense expecting it to sync later.
 */
export default function OfflinePage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto w-full max-w-5xl px-4 py-4">
          <Wordmark />
        </div>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <OfflineNotice />
      </main>
    </div>
  );
}
