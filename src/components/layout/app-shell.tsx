import Link from "next/link";
import type { ReactNode } from "react";
import { Wordmark } from "@/components/brand/wordmark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { InstallInstructions } from "@/components/pwa/install-instructions";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationRefresh } from "@/components/notifications/notification-refresh";
import { Screen } from "@/components/motion/screen";
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
  leading,
}: {
  children: ReactNode;
  actor: {
    label: string;
    isGuest: boolean;
  };
  className?: string;
  bottomNav?: ReactNode;
  /**
   * What sits at the head of the header. The wordmark, and its link home, is
   * what a screen gets for saying nothing — a group replaces it with the way
   * out of the group and the way across to another one.
   */
  leading?: ReactNode;
}) {
  return (
    // Clipped, because a screen dragged towards the right edge must not push
    // the page sideways. `clip` rather than `hidden`: it establishes no scroll
    // container, so the header above still sticks to the viewport.
    <div className="flex min-h-dvh flex-col overflow-x-clip">
      <header
        data-slot="app-header"
        // Above the bottom bar rather than level with it, so a panel hung from
        // the header can dim the rest of the chrome without dimming the
        // control that opened it.
        className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      >
        {/* Positioned, so a leading control can anchor a panel to the header's
            full width rather than to its own. */}
        <div className="relative mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3">
          {leading ?? (
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
          )}
          <div className="flex shrink-0 items-center gap-1">
            {/* Guests have no account, so nothing to notify and no bell. */}
            {!actor.isGuest && <NotificationBell />}
            <ThemeToggle />
            <UserMenu label={actor.label} isGuest={actor.isGuest} />
          </div>
        </div>
      </header>

      {/* The padding lives on the screen inside, not here: it has to be part
          of what the transition takes a picture of. */}
      <main data-slot="app-screen" className={cn("flex-1", className)}>
        <Screen inset={Boolean(bottomNav)}>{children}</Screen>
      </main>

      {bottomNav}

      {/* Mounted once here so the account menu can open it from any page; it
          renders nothing until something asks for installation instructions. */}
      <InstallInstructions />

      {/* Re-reads the unread count when a push lands on an open tab. */}
      {!actor.isGuest && <NotificationRefresh />}
    </div>
  );
}
