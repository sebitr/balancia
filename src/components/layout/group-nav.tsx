"use client";

import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Plus,
  Receipt,
  Scale,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  POP,
  SWITCH_BACK,
  SWITCH_FORWARD,
} from "@/components/motion/transitions";
import { useOfflineEntry } from "@/components/offline/offline-entry";
import { useOnline } from "@/components/offline/use-online";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A group's navigation, drawn twice: as a bar along the bottom of a phone
 * (`GroupNav`) and as a rail down the left of a desktop window (`GroupRail`).
 *
 * The two are one navigation, and only ever one of them is on screen. The bar
 * is `lg:hidden` and the rail is `hidden lg:flex`, and `display: none` takes
 * an element out of the accessibility tree as well as off the screen — so at
 * any width a screen reader finds exactly one landmark called "Group
 * sections", never a second copy of the same five links. Everything the two
 * share — the destinations, which one is lit, the direction a tap moves the
 * screen, Add's way round a dropped network — is worked out once, below, and
 * only the drawing differs.
 *
 * On the bar, "Add" is centred and breaks the bar's own line — a raised disc
 * punched through the top border by a ring in the page colour. Recording an
 * expense is the thing people open a group to do, and it is the only action
 * here that creates something, so it is the only one drawn as a button rather
 * than as a destination. The rail says the same thing in its own terms: Add is
 * the filled button at its head, above the four places.
 */
interface NavItem {
  readonly href: string;
  /** Key in the `nav` namespace; resolved at render time. */
  readonly labelKey: "overview" | "expenses" | "add" | "people" | "settings";
  readonly icon: LucideIcon;
  readonly exact: boolean;
  /**
   * Other prefixes this tab answers to.
   *
   * A repayment is filed under `/settlements` because it is a different table,
   * which is a fact about the database and not about where the reader thinks
   * they are: they tapped a row in the transactions list and the screen they
   * landed on is one of that list's rows. A bar that goes dark at that moment
   * says they have left a section they are plainly still in.
   */
  readonly owns?: readonly string[];
  /** Rendered as a filled action button — the primary thing to do here. */
  readonly primary?: boolean;
}

const ITEMS: readonly NavItem[] = [
  { href: "", labelKey: "overview", icon: Scale, exact: true },
  {
    href: "/expenses",
    labelKey: "expenses",
    icon: Receipt,
    exact: false,
    owns: ["/settlements"],
  },
  {
    href: "/expenses/new",
    labelKey: "add",
    icon: Plus,
    exact: true,
    primary: true,
  },
  { href: "/members", labelKey: "people", icon: Users, exact: false },
  { href: "/settings", labelKey: "settings", icon: Settings, exact: false },
];

/**
 * How specifically a tab claims this path, or null when it does not.
 *
 * The length of the prefix that matched, so the caller can rank overlapping
 * claims — /expenses/new is under both "Expenses" and "Add", and the longer
 * one is the more specific tab.
 */
function claimOf(item: NavItem, pathname: string, base: string): number | null {
  if (item.exact) {
    return pathname === `${base}${item.href}` ? item.href.length : null;
  }
  let best: number | null = null;
  for (const prefix of [item.href, ...(item.owns ?? [])]) {
    if (pathname.startsWith(`${base}${prefix}`)) {
      best = Math.max(best ?? 0, prefix.length);
    }
  }
  return best;
}

/**
 * Which tab the current path belongs to, or -1 when it belongs to none.
 *
 * A sideways move needs to know where it starts as well as where it is going,
 * and prefix matches overlap, so the longest claim wins.
 */
function activeIndexOf(pathname: string, base: string): number {
  let best = -1;
  let bestClaim = -1;
  ITEMS.forEach((item, index) => {
    const claim = claimOf(item, pathname, base);
    if (claim !== null && claim > bestClaim) {
      best = index;
      bestClaim = claim;
    }
  });
  return best;
}

/**
 * The motion a tap on this tab should carry, or none.
 *
 * "Add" carries none: it opens a drawer *over* the group rather than going
 * anywhere, and the sheet's own rise is the whole animation. The screen
 * underneath stays put — `screenPath` is what keeps it there, and a direction
 * here would only describe motion that no longer happens.
 *
 * The rest are sections of the same place: they fade through, nudged the way
 * the bar itself runs, and which way that is depends on the tab being left.
 * From a screen that sits on no tab at all — a balance, an expense, the
 * activity log — every tab is the way back out, which is a pop.
 */
function directionFor(
  item: NavItem,
  index: number,
  activeIndex: number,
): string[] | undefined {
  if (item.primary) return undefined;
  if (activeIndex === -1) return POP;
  return index > activeIndex ? SWITCH_FORWARD : SWITCH_BACK;
}

/** One destination as both drawings need it: resolved against the path. */
interface Tab {
  readonly item: NavItem;
  readonly href: string;
  readonly label: string;
  /** Lit: this is where the reader is. */
  readonly isActive: boolean;
  /** The motion a tap carries, or none — see `directionFor`. */
  readonly transitionTypes: string[] | undefined;
  readonly onClick: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * The five destinations, resolved against where the reader is now.
 *
 * Shared by the bar and the rail, so the two cannot disagree about which tab
 * is lit or which way a tap moves the screen — the rail lists its places in
 * the bar's own order, top to bottom, so "forward" still means further along.
 */
function useTabs(groupId: string): { tabs: Tab[]; name: string } {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const base = `/groups/${groupId}`;
  const activeIndex = activeIndexOf(pathname, base);
  /*
   * Adding an entry is a route, and a route is a request. With no network
   * there is nothing to answer it, and the reader would get the offline shell
   * where they expected a form — so the tap is intercepted and the same form
   * is opened from the copy on the device instead.
   *
   * Only the Add tab. The other four are places to read the group, and a
   * place that cannot be loaded should say so rather than pretend.
   */
  const online = useOnline();
  const offlineEntry = useOfflineEntry();

  const tabs = ITEMS.map((item, index) => ({
    item,
    href: `${base}${item.href}`,
    label: t(item.labelKey),
    // The same claim the direction is ranked from, so a tab cannot be lit
    // without being the one a sideways move counts from.
    isActive: claimOf(item, pathname, base) !== null,
    transitionTypes: directionFor(item, index, activeIndex),
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (item.primary && !online && offlineEntry) {
        event.preventDefault();
        offlineEntry.open();
      }
    },
  }));

  // The landmark's name, and the same one at either width: it is one
  // navigation, so a screen reader should not be told it has found another.
  return { tabs, name: t("groupSections") };
}

/** The bar along the bottom of a phone. Gone from `lg` up — see `GroupRail`. */
export function GroupNav({ groupId }: { groupId: string }) {
  const { tabs, name } = useTabs(groupId);

  return (
    <nav
      data-slot="app-nav"
      aria-label={name}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85 lg:hidden"
    >
      <ul className="mx-auto flex w-full max-w-3xl items-stretch justify-between px-2 pb-2">
        {tabs.map(
          ({ item, href, label, isActive, transitionTypes, onClick }) => (
            <li key={item.labelKey} className="flex-1">
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                transitionTypes={transitionTypes}
                onClick={onClick}
                className={cn(
                  "flex flex-col items-center rounded-xl px-1 py-2.5 text-xs font-medium transition-transform duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
                  item.primary
                    ? // Lifted out of the bar, and the label keeps full
                      // contrast: this one is an action, not a place.
                      "-mt-[26px] gap-[5px] text-foreground hover:-translate-y-px active:translate-y-px motion-reduce:hover:translate-y-0 motion-reduce:active:translate-y-0"
                    : cn(
                        "gap-1 transition-colors",
                        isActive
                          ? "text-primary-ink"
                          : "text-muted-foreground hover:text-foreground",
                      ),
                )}
              >
                <span
                  className={cn(
                    "flex items-center justify-center rounded-full transition-colors",
                    item.primary
                      ? "size-[54px] bg-primary text-primary-foreground shadow-[0_0_0_6px_var(--background),0_10px_20px_-8px_color-mix(in_oklch,var(--primary)_55%,transparent)]"
                      : cn("size-8", isActive ? "bg-accent" : "bg-transparent"),
                  )}
                >
                  <item.icon
                    aria-hidden="true"
                    className={item.primary ? "size-[26px]" : "size-4.5"}
                    strokeWidth={item.primary ? 2.2 : undefined}
                  />
                </span>
                {label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

/**
 * The rail down the left of a desktop window, from `lg` up.
 *
 * Rendered inside the shell's header, between the group switcher and the
 * account, because from `lg` up the header *is* the rail: it stands up the
 * left edge and these sit in the middle of it. That is also what puts them in
 * the right place for a keyboard — the switcher, then Add and the four places,
 * then the bell and the account, then the screen, which is the order they are
 * drawn in. Below `lg` the header lies back down along the top and this is
 * `display: none`, which the bar's twin needs it to be.
 *
 * Denser than the bar, because a pointer is not a thumb: 40px rows rather than
 * 74px tabs. The current place keeps the bar's two cues — the label in the
 * primary ink and the accent disc behind its icon — so the same section is lit
 * the same way at either width.
 */
export function GroupRail({ groupId }: { groupId: string }) {
  const { tabs, name } = useTabs(groupId);
  const add = tabs.find((tab) => tab.item.primary);
  const places = tabs.filter((tab) => !tab.item.primary);

  return (
    <nav
      data-slot="app-rail-nav"
      aria-label={name}
      className="hidden flex-col gap-3.5 lg:mt-5 lg:flex"
    >
      {add && (
        <Button
          asChild
          size="lg"
          className="w-full rounded-xl font-semibold md:h-10"
        >
          <Link
            href={add.href}
            aria-current={add.isActive ? "page" : undefined}
            transitionTypes={add.transitionTypes}
            onClick={add.onClick}
          >
            <add.item.icon
              aria-hidden="true"
              className="size-4.5"
              strokeWidth={2.2}
            />
            {add.label}
          </Link>
        </Button>
      )}
      <ul className="flex flex-col gap-0.5">
        {places.map(
          ({ item, href, label, isActive, transitionTypes, onClick }) => (
            <li key={item.labelKey}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                transitionTypes={transitionTypes}
                onClick={onClick}
                // The height is `lg:` because the rail is: below `lg` none of
                // this is drawn, and a phone's 44px floor never meets it.
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-1 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none lg:h-10",
                  isActive
                    ? "text-primary-ink"
                    : "text-muted-foreground hover:bg-wash-2 hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                    isActive ? "bg-accent" : "bg-transparent",
                  )}
                >
                  <item.icon aria-hidden="true" className="size-4.5" />
                </span>
                {label}
              </Link>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}
