import type { Metadata } from "next";
import { WifiOff } from "lucide-react";
import { Wordmark } from "@/components/brand/wordmark";
import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = { title: "Offline" };

/**
 * Offline fallback shell.
 *
 * Static by design: it must render from the precache with no network and no
 * database. It says plainly that Balancia does not accept offline entries in
 * this version, so nobody types an expense expecting it to sync later.
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
        <div className="max-w-md space-y-4 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <WifiOff aria-hidden="true" className="size-6" />
          </span>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">
            You are offline
          </h1>
          <p className="text-pretty text-muted-foreground">
            Balancia needs a connection to your server to show balances and
            record expenses. Nothing is lost — reconnect and everything will be
            where you left it.
          </p>
          <p className="text-sm text-pretty text-muted-foreground">
            This version does not store expenses on your device while offline,
            so nothing entered here would be saved.
          </p>
          <RetryButton />
        </div>
      </main>
    </div>
  );
}
