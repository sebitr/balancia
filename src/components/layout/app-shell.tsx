import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { UserMenu } from "./user-menu";
import { cn } from "@/lib/utils";

/**
 * Shell for signed-in pages.
 *
 * Mobile-first: the header stays minimal and group pages add a bottom
 * navigation bar. Content is capped at a readable width and padded for the
 * safe area so the bottom bar clears a phone's home indicator.
 */
export function AppShell({
  children,
  actor,
  className,
  bottomNav,
}: {
  children: ReactNode;
  actor: { label: string; email?: string; isGuest: boolean };
  className?: string;
  bottomNav?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          <Link
            href={actor.isGuest ? "#" : "/dashboard"}
            aria-disabled={actor.isGuest}
            tabIndex={actor.isGuest ? -1 : undefined}
            className={cn(
              "rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
              actor.isGuest && "pointer-events-none",
            )}
          >
            <Wordmark />
          </Link>
          <UserMenu
            label={actor.label}
            email={actor.email}
            isGuest={actor.isGuest}
          />
        </div>
      </header>

      <main
        className={cn(
          "mx-auto w-full max-w-3xl flex-1 px-4 py-6",
          bottomNav && "pb-28",
          className,
        )}
      >
        {children}
      </main>

      {bottomNav}
    </div>
  );
}
