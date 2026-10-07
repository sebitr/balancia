import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { SplittingWordmark } from "@/components/brand/splitting-wordmark";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { InstallInstructions } from "@/components/pwa/install-instructions";
import { SerwistRegister } from "@/components/pwa/serwist-register";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { NotificationRefresh } from "@/components/notifications/notification-refresh";
import { Screen } from "@/components/motion/screen";
import { DemoBanner } from "@/components/demo/demo-banner";
import { AppSidebar } from "./app-sidebar";
import { CommandPalette } from "./command-palette";
import { RefreshOnReturn } from "./refresh-on-return";
import { SidebarFrame } from "./sidebar-context";
import { SidebarGroupsFallback } from "./sidebar-groups";
import { SidebarGroupsLoader } from "./sidebar-groups-loader";
import { UserMenu } from "./user-menu";
import { cn } from "@/lib/utils";

/**
 * Shell for signed-in pages.
 *
 * Mobile-first: the header stays minimal and group pages add a bottom
 * navigation bar. Content is capped at a readable width and padded for the
 * safe area so the bottom bar clears a phone's home indicator.
 *
 * ## From `lg` up, the sidebar
 *
 * From `lg` (1024px) up every screen this shell draws — Home and
 * Notifications as much as a group — stands a sidebar down the left of the
 * window and drops both the header along the top and the group's bottom bar.
 * The sidebar holds the wordmark, Search and Add expense, Home and
 * Notifications, every group with where the reader stands in it, and the
 * account; see `app-sidebar.tsx`. The header and the bar stay in the document
 * and are `lg:hidden`, the sidebar is `hidden lg:flex`, and `display: none`
 * takes each out of the accessibility tree too — so a screen reader finds one
 * banner and one set of controls at any width, never both.
 *
 * Every signed-in screen, and not only a group's, by the owner's decision of
 * 2026-10-06 (the desktop experience spec, §1). This comment used to argue the
 * other way: that a screen with no group — the dashboard, notifications, a new
 * group — had nothing to navigate between, and that a rail holding only a
 * wordmark and an avatar would be chrome for its own sake. That was true of
 * #438's rail, which carried one group's places. The sidebar carries every
 * group and its balance, Search and Add, so there is something to navigate
 * between on every screen — and Home, where a reader goes to choose a group,
 * is the last place it should disappear from. Settings is the exception, and
 * keeps its own reasoning: it is a surface with one way out, not a page in
 * this shell (`src/app/settings/layout.tsx`).
 *
 * `lg` rather than `md`, because `md` is where the type scale drops to its
 * desk sizes and a tablet held upright is still held like a phone: at 768px a
 * 240px sidebar would leave the screen a column no wider than a phone's,
 * which buys nothing, while at 1024px the sidebar and two phone-width columns
 * fit side by side. Below `lg` none of the classes added here apply.
 *
 * ## The keyboard
 *
 * The shell is also where the app's keys are answered, once, for every screen
 * it draws: ⌘K opens the command palette, N adds an expense, S settles up,
 * ⌘\ folds the sidebar — from `lg` up, where the sidebar holds a control for
 * each. `CommandPalette`, mounted once beside the screen, is the palette and
 * the one listener (`use-shortcuts.ts`); the sidebar's Search opens it too.
 * Settings, a surface outside this shell, answers none of them.
 */
export function AppShell({
  children,
  actor,
  className,
  bottomNav,
  leading,
  group = null,
  groupHeader,
  sidebarAdd,
  sidebarCollapsed = false,
}: {
  children: ReactNode;
  actor: {
    label: string;
    isGuest: boolean;
  };
  className?: string;
  bottomNav?: ReactNode;
  /**
   * What sits at the head of the phone's header. The wordmark, and its link
   * home, is what a screen gets for saying nothing — a group replaces it with
   * the way out of the group and the way across to another one.
   */
  leading?: ReactNode;
  /**
   * The group the screen belongs to. The sidebar lights it, and its Add adds
   * to it rather than asking which group first.
   */
  group?: { id: string; name: string } | null;
  /**
   * What stands above the screen from `lg` up: a group's tile, name and tabs.
   * It takes the place of the phone's header and bar there, and is not drawn
   * below `lg`.
   */
  groupHeader?: ReactNode;
  /**
   * A group's own Add for the sidebar, which adds to it rather than asking
   * which group first; see `sidebar-group-add.tsx`.
   */
  sidebarAdd?: ReactNode;
  /** Whether this device keeps the sidebar folded; see `sidebar-state.ts`. */
  sidebarCollapsed?: boolean;
}) {
  const t = useTranslations("nav");
  const tGuest = useTranslations("guestWidget");

  return (
    // Clipped, because a screen dragged towards the right edge must not push
    // the page sideways. `clip` rather than `hidden`: it establishes no scroll
    // container, so the header above still sticks to the viewport.
    //
    // From `lg` up, a two-column grid: the sidebar, then the screen. A grid
    // rather than a fixed sidebar, so the demo banner can still run across
    // the top of both and scroll away, and the sidebar — sticky, not fixed —
    // starts under it rather than over it. `content-start`, so a short
    // screen does not share its spare height out between the banner and the
    // rest. The first column is whatever width the sidebar is now, which the
    // frame states as `--app-sidebar-w`.
    <SidebarFrame
      initialCollapsed={sidebarCollapsed}
      className="flex min-h-dvh flex-col overflow-x-clip lg:grid lg:grid-cols-[var(--app-sidebar-w)_minmax(0,1fr)] lg:content-start lg:*:data-[slot=demo-banner]:col-span-2"
    >
      {/* The first thing a keyboard meets from `lg` up: Search, Add, Home,
          Notifications, every group and the account are a dozen stops or
          more before the screen. Below `lg` the header carries three and the
          bar comes after the screen, so there is nothing to skip. Parked
          above the top edge rather than `sr-only`, so focusing it is one
          transform and not a change of position scheme. */}
      <a
        href="#app-content"
        className="hidden rounded-lg bg-background px-3 py-2 text-sm font-medium text-foreground shadow-lg ring-2 ring-ring outline-none motion-safe:transition-transform lg:fixed lg:top-3 lg:left-3 lg:z-50 lg:block lg:-translate-y-16 lg:focus:translate-y-0"
      >
        {t("skipToContent")}
      </a>
      {/* Above the header, and not sticky: it is a standing fact about the
          instance, not a control, and it should scroll away like one. */}
      <DemoBanner />

      <AppSidebar
        actor={actor}
        group={group}
        add={sidebarAdd}
        notifications={
          actor.isGuest ? undefined : <NotificationBell variant="sidebar" />
        }
        groups={
          actor.isGuest ? undefined : (
            <Suspense
              fallback={<SidebarGroupsFallback groupId={group?.id ?? null} />}
            >
              <SidebarGroupsLoader groupId={group?.id ?? null} />
            </Suspense>
          )
        }
        guestCard={
          actor.isGuest && group ? (
            <div className="mt-3 flex flex-col gap-2.5 rounded-2xl bg-card p-3.5 ring-1 ring-border">
              <p className="text-sm font-medium">
                {t("sidebarKeepGroup", { group: group.name })}
              </p>
              <p className="text-xs text-pretty text-muted-foreground">
                {t("sidebarGuestNote")}
              </p>
              <Link
                href="/register"
                className="tap-target inline-flex h-9 items-center justify-center rounded-xl border border-input bg-background px-3 text-sm font-medium transition-colors hover:bg-wash-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              >
                {tGuest("cta")}
              </Link>
            </div>
          ) : undefined
        }
      />

      <header
        data-slot="app-header"
        // Above the bottom bar rather than level with it, so a panel hung from
        // the header can dim the rest of the chrome without dimming the
        // control that opened it. Gone from `lg` up, where the sidebar holds
        // all of it.
        className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 lg:hidden"
      >
        {/* Positioned, so a leading control can anchor a panel to the header's
            full width rather than to its own. */}
        {/* The height is stated rather than left to the tallest control in the
            row, because the position strip has to hang exactly below it and
            cannot measure it — see `--app-header-h` in globals.css. */}
        <div className="relative mx-auto flex h-(--app-header-h) w-full max-w-3xl items-center justify-between gap-3 px-4">
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
          <div className="flex shrink-0 items-center gap-1">
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
          of what the transition takes a picture of. A group's header comes
          first, outside the transition, so the tabs stay put while the
          screen under them moves. */}
      <main
        id="app-content"
        data-slot="app-screen"
        className={cn("group/app-screen flex-1 lg:col-start-2", className)}
      >
        {groupHeader}
        <Screen inset={Boolean(bottomNav)} sidebar>
          {children}
        </Screen>
      </main>

      {bottomNav}

      {/* Mounted once here so the account menu can open it from any page; it
          renders nothing until something asks for installation instructions. */}
      <InstallInstructions />

      {/* "Search or jump to", and the keys of every screen in the shell: ⌘K,
          N, S and ⌘\. Mounted once here, for the same reason as the sheet
          above — the sidebar's Search opens it from deep inside the shell. */}
      <CommandPalette group={group} isGuest={actor.isGuest} />

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
    </SidebarFrame>
  );
}
