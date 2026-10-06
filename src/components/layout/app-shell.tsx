import Link from "next/link";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SplittingWordmark } from "@/components/brand/splitting-wordmark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { InstallInstructions } from "@/components/pwa/install-instructions";
import { SerwistRegister } from "@/components/pwa/serwist-register";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationRefresh } from "@/components/notifications/notification-refresh";
import { Screen } from "@/components/motion/screen";
import { DemoBanner } from "@/components/demo/demo-banner";
import { RefreshOnReturn } from "./refresh-on-return";
import { UserMenu } from "./user-menu";
import { cn } from "@/lib/utils";

/**
 * Shell for signed-in pages.
 *
 * Mobile-first: the header stays minimal and group pages add a bottom
 * navigation bar. Content is capped at a readable width and padded for the
 * safe area so the bottom bar clears a phone's home indicator.
 *
 * ## From `lg` up, a group gets a rail
 *
 * A screen that passes `rail` — a group's — stands its header up the left
 * edge of the window from `lg` (1024px) up, and drops the bottom bar. The
 * switcher stays at the top, the rail's navigation fills the middle, and the
 * bell and the account sit at the foot: the same controls, in the same
 * document order, drawn as a column. Nothing is mounted twice except the
 * navigation itself, whose bar and rail are each `display: none` at the
 * other's widths — see `group-nav.tsx`.
 *
 * `lg` rather than `md`, because `md` is where the type scale drops to its
 * desk sizes and a tablet held upright is still held like a phone: at 768px a
 * 240px rail would leave the screen a column no wider than a phone's, which
 * buys nothing, while at 1024px the rail and two phone-width columns fit side
 * by side. Below `lg` none of the classes added here apply.
 *
 * A screen without a rail — the dashboard, notifications, a new group — keeps
 * the header along the top at every width: there is nothing to navigate
 * between, and a rail holding a wordmark and an avatar would be chrome for its
 * own sake.
 */
export function AppShell({
  children,
  actor,
  className,
  bottomNav,
  rail,
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
   * The navigation the header carries from `lg` up, when the header has
   * become a rail. Pair it with `bottomNav`: the one replaces the other.
   */
  rail?: ReactNode;
  /**
   * What sits at the head of the header. The wordmark, and its link home, is
   * what a screen gets for saying nothing — a group replaces it with the way
   * out of the group and the way across to another one.
   */
  leading?: ReactNode;
}) {
  const t = useTranslations("nav");
  const hasRail = Boolean(rail);

  return (
    // Clipped, because a screen dragged towards the right edge must not push
    // the page sideways. `clip` rather than `hidden`: it establishes no scroll
    // container, so the header above still sticks to the viewport.
    //
    // With a rail, a two-column grid from `lg` up: the rail, then the screen.
    // A grid rather than a fixed rail, so the demo banner can still run across
    // the top of both and scroll away, and the rail — sticky, not fixed —
    // starts under it rather than over it. `content-start`, so a short screen
    // does not share its spare height out between the banner and the rest.
    <div
      className={cn(
        "flex min-h-dvh flex-col overflow-x-clip",
        hasRail &&
          "lg:grid lg:grid-cols-[var(--app-rail-w)_minmax(0,1fr)] lg:content-start lg:*:data-[slot=demo-banner]:col-span-2",
      )}
    >
      {/* The first thing a keyboard meets, and only where there is a rail to
          get past: switcher, Add, four places, the bell and the account are
          eight stops before the screen. Below `lg` the header carries three
          and the bar comes after the screen, so there is nothing to skip.
          Parked above the top edge rather than `sr-only`, so focusing it is
          one transform and not a change of position scheme. */}
      {hasRail && (
        <a
          href="#app-content"
          className="hidden rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring outline-none motion-safe:transition-transform lg:fixed lg:top-3 lg:left-3 lg:z-50 lg:block lg:-translate-y-16 lg:focus:translate-y-0"
        >
          {t("skipToContent")}
        </a>
      )}
      {/* Above the header, and not sticky: it is a standing fact about the
          instance, not a control, and it should scroll away like one. */}
      <DemoBanner />
      <header
        data-slot="app-header"
        // Above the bottom bar rather than level with it, so a panel hung from
        // the header can dim the rest of the chrome without dimming the
        // control that opened it.
        className={cn(
          "sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80",
          // The rail: the window's full height, ruled off from the screen
          // beside it rather than from the screen below.
          hasRail &&
            "lg:col-start-1 lg:h-dvh lg:self-start lg:border-r lg:border-b-0",
        )}
      >
        {/* Positioned, so a leading control can anchor a panel to the header's
            full width rather than to its own. */}
        {/* The height is stated rather than left to the tallest control in the
            row, because the position strip has to hang exactly below it and
            cannot measure it — see `--app-header-h` in globals.css. */}
        <div
          className={cn(
            "relative mx-auto flex h-(--app-header-h) w-full max-w-3xl items-center justify-between gap-3 px-4",
            // Stood on end: the switcher, the navigation, then the account at
            // the foot. The order is the document's, so Tab walks it top to
            // bottom.
            hasRail &&
              "lg:h-full lg:max-w-none lg:flex-col lg:items-stretch lg:justify-start lg:gap-0 lg:px-3 lg:pt-4 lg:pb-3",
          )}
        >
          {leading ?? (
            <Link
              href={actor.isGuest ? "#" : "/dashboard"}
              aria-disabled={actor.isGuest}
              tabIndex={actor.isGuest ? -1 : undefined}
              className={cn(
                // `inline-flex`, so the wordmark is the whole of this link's
                // height. Left inline, the anchor carries a text line box the
                // wordmark hangs from the top of, and the descender space
                // below it stood the mark three pixels above the middle of a
                // header a group screen centres its own mark in.
                "tap-target inline-flex items-center rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
                actor.isGuest && "pointer-events-none",
              )}
            >
              <SplittingWordmark />
            </Link>
          )}
          {/* Between the switcher and the account, so it is read and tabbed
              in the order it is drawn. It hides itself below `lg`. */}
          {rail}
          <div
            className={cn(
              "flex shrink-0 items-center gap-1",
              // The foot of the rail, ruled off from the navigation above it
              // across the rail's full width.
              hasRail && "lg:-mx-3 lg:mt-auto lg:border-t lg:px-3 lg:pt-3",
            )}
          >
            {/* Guests have no account, so nothing to notify and no bell. */}
            {!actor.isGuest && <NotificationBell />}
            {/* The theme lives in Settings › Appearance, one tap behind the
                avatar, so a signed-in reader does not need it in the header
                of every screen as well. A guest has no settings hub, and this
                is the only place they can change it. */}
            {actor.isGuest && <ThemeToggle />}
            <UserMenu label={actor.label} isGuest={actor.isGuest} />
          </div>
        </div>
      </header>

      {/* The padding lives on the screen inside, not here: it has to be part
          of what the transition takes a picture of. */}
      <main
        id="app-content"
        data-slot="app-screen"
        className={cn("flex-1", hasRail && "lg:col-start-2", className)}
      >
        <Screen inset={Boolean(bottomNav)} rail={hasRail}>
          {children}
        </Screen>
      </main>

      {bottomNav}

      {/* Mounted once here so the account menu can open it from any page; it
          renders nothing until something asks for installation instructions. */}
      <InstallInstructions />

      {/* Re-reads the unread count when a push lands on an open tab. */}
      {!actor.isGuest && <NotificationRefresh />}

      {/* Re-reads the screen itself when the reader comes back to it after
          long enough away. Guests get it too: their balances go stale in
          exactly the same way, and an installed app gives neither of them a
          reload button. */}
      <RefreshOnReturn />

      {/* The service worker, and with it the offline screen, the precache
          and push, from the first screen of the app rather than from the
          homepage. Guests get it too: a group is exactly what they would
          want to open with no signal. */}
      <SerwistRegister />
    </div>
  );
}
