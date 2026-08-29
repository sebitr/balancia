"use client";

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
import { cn } from "@/lib/utils";

/**
 * Bottom navigation for a group, mobile-first.
 *
 * "Add" is centred and breaks the bar's own line — a raised disc punched
 * through the top border by a ring in the page colour. Recording an expense is
 * the thing people open a group to do, and it is the only action here that
 * creates something, so it is the only one drawn as a button rather than as a
 * destination.
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

export function GroupNav({ groupId }: { groupId: string }) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const base = `/groups/${groupId}`;
  const activeIndex = activeIndexOf(pathname, base);

  return (
    <nav
      data-slot="app-nav"
      aria-label={t("groupSections")}
      className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur supports-[backdrop-filter]:bg-background/85"
    >
      <ul className="mx-auto flex w-full max-w-3xl items-stretch justify-between px-2 pb-2">
        {ITEMS.map((item, index) => {
          const href = `${base}${item.href}`;
          // The same claim the direction is ranked from, so a tab cannot be
          // lit without being the one a sideways move counts from.
          const isActive = claimOf(item, pathname, base) !== null;

          return (
            <li key={item.labelKey} className="flex-1">
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                transitionTypes={directionFor(item, index, activeIndex)}
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
                {t(item.labelKey)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
