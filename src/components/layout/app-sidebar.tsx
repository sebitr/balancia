"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  House,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
} from "lucide-react";
import { BalanciaMark } from "@/components/brand/wordmark";
import { SplittingWordmark } from "@/components/brand/splitting-wordmark";
import {
  AddExpenseSheet,
  type PickableGroup,
} from "@/components/dashboard/add-expense-sheet";
import { POP } from "@/components/motion/transitions";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Kbd, useModifierKey } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import {
  openCommandPalette,
  useCommandPaletteAvailable,
} from "./command-palette";
import { SidebarTip, useSidebar } from "./sidebar-context";
import { useKnownGroups } from "./sidebar-groups";
import { UserMenu } from "./user-menu";

/**
 * The sidebar: the one piece of chrome a desktop window has, on every
 * signed-in screen from `lg` (1024px) up.
 *
 * Top to bottom: the wordmark (the way home) and the toggle that folds the
 * column to its icons; Search; Add expense, the one filled button; Home and
 * Notifications; every group, with where the reader stands in it; and the
 * account at the foot. It replaces the header along the top and the group's
 * bottom bar, both of which are `lg:hidden` — so it is the page's banner from
 * `lg` up, as the header is below it, and a screen reader finds one of each at
 * any width.
 *
 * It is the group switcher, too. The phone opens a panel from the group's name
 * to reach another group; here every group is always in view, with its
 * balance, which is the reason the sidebar is on Home and Notifications as
 * well as inside a group — it is where the reader chooses where to go.
 *
 * Folded (`collapsed`), it is a 4rem column of 44px targets. Every label
 * stays in the document as the control's name and comes back as a tip on
 * hover or focus; a group's tile carries its name and balance the same way,
 * and never a colour that would stand for the money. The choice is kept per
 * device — see `sidebar-state.ts`.
 *
 * A guest has one group and no account: the sidebar heads with that group's
 * name, searches only it, and keeps no Home, Notifications or list of groups.
 * What it has instead is the case for an account, and the theme, which a
 * guest has nowhere else to change.
 *
 * Rows, the notification count and the groups are slots the shell fills on
 * the server — the count and the list come from reads this component cannot
 * make — and each draws itself folded or not from `useSidebar`.
 */
export function AppSidebar({
  actor,
  group,
  notifications,
  groups,
  guestCard,
  add,
}: {
  actor: { label: string; isGuest: boolean };
  /** The group the screen belongs to, when it belongs to one. */
  group: { id: string; name: string } | null;
  /**
   * Inside a group, its own Add (`SidebarGroupAdd`): the bar's link, into the
   * drawer over the screen. Outside one, Add asks which group first.
   */
  add?: ReactNode;
  /** The Notifications row, with its unread count. Absent for a guest. */
  notifications?: ReactNode;
  /** The list of groups, streamed in. Absent for a guest. */
  groups?: ReactNode;
  /** A guest's reason to make an account. */
  guestCard?: ReactNode;
}) {
  const t = useTranslations("nav");
  const { collapsed, setCollapsed } = useSidebar();
  // "Search or jump to" opens the command palette the shell mounts beside
  // the sidebar. Drawn, named and disabled where there is none to open,
  // rather than pressable and inert.
  const canSearch = useCommandPaletteAvailable();
  const { isGuest } = actor;

  const toggleLabel = collapsed ? t("sidebarExpand") : t("sidebarCollapse");
  const searchLabel = isGuest ? t("sidebarSearchGroup") : t("sidebarSearch");

  return (
    <header
      data-slot="app-sidebar"
      className={cn(
        "hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:sticky lg:top-0 lg:col-start-1 lg:flex lg:h-dvh lg:flex-col lg:self-start",
        collapsed ? "lg:items-stretch lg:px-2 lg:py-3" : "lg:p-3",
      )}
    >
      <div
        className={cn(
          "flex shrink-0",
          collapsed
            ? "flex-col items-center gap-1.5"
            : "h-11 items-center justify-between pr-0.5 pl-1.5",
        )}
      >
        {isGuest ? (
          // A guest has no Home to go back to: the mark and the group's name,
          // as the phone's header gives them, and nothing to press.
          <span className="flex min-w-0 items-center gap-2.5">
            <BalanciaMark className="size-[26px] shrink-0" />
            <span
              className={cn(
                "truncate text-base font-semibold",
                collapsed && "sr-only",
              )}
            >
              {group?.name}
            </span>
          </span>
        ) : (
          <SidebarTip content={t("home")}>
            <Link
              href="/dashboard"
              aria-label={t("home")}
              transitionTypes={group ? POP : undefined}
              className={cn(
                "tap-target inline-flex items-center rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                collapsed && "size-11 justify-center",
              )}
            >
              <SplittingWordmark
                className="gap-2"
                markClassName="size-[26px]"
                wordClassName={cn("text-lg", collapsed && "sr-only")}
              />
            </Link>
          </SidebarTip>
        )}

        <SidebarTip content={toggleLabel}>
          <button
            type="button"
            aria-label={toggleLabel}
            // ⌘\ (Ctrl \) presses this; the attribute is where the key
            // looks for it — see `use-shortcuts.ts`.
            data-shortcut="mod+backslash"
            onClick={() => setCollapsed(!collapsed)}
            className="tap-target inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] text-muted-foreground transition-colors hover:bg-wash-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" className="size-[18px]" />
            ) : (
              <PanelLeftClose aria-hidden="true" className="size-[18px]" />
            )}
          </button>
        </SidebarTip>
      </div>

      {collapsed && <Rule />}

      <SidebarTip content={searchLabel}>
        <button
          type="button"
          onClick={openCommandPalette}
          disabled={!canSearch}
          aria-haspopup="dialog"
          // The palette opens on ⌘K (Ctrl K) from anywhere too; see
          // `use-shortcuts.ts`.
          data-shortcut="mod+k"
          aria-label={collapsed ? searchLabel : undefined}
          className={cn(
            "tap-target flex shrink-0 items-center rounded-[10px] text-sm text-muted-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default motion-reduce:transition-none",
            collapsed
              ? "mx-auto size-11 justify-center enabled:hover:bg-wash-2"
              : "mt-1.5 mb-0.5 h-9 w-full gap-2 border border-input bg-card pr-1.5 pl-2.5 text-left enabled:hover:text-foreground",
          )}
        >
          <Search aria-hidden="true" className="size-4 shrink-0" />
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate">{searchLabel}</span>
              <ShortcutHint />
            </>
          )}
        </button>
      </SidebarTip>

      {add ?? <ChooseGroupAdd />}

      {!isGuest && (
        <nav aria-label="Balancia" className="flex shrink-0 flex-col gap-0.5">
          <SidebarLink
            href="/dashboard"
            icon={<House aria-hidden="true" className="size-[18px] shrink-0" />}
            label={t("sidebarHome")}
            // Out of a group is back up a level; from Notifications it is a
            // peer, and goes nowhere in particular.
            transitionTypes={group ? POP : undefined}
          />
          {notifications}
        </nav>
      )}

      {!isGuest && (
        <div className="mt-3.5 flex min-h-0 flex-1 flex-col">
          {collapsed ? <Rule /> : <SectionHead label={t("sidebarGroups")} />}
          {/* Scrolls on its own, so a long list never pushes the account off
              the foot of the window. */}
          <nav
            aria-label={t("yourGroups")}
            className={cn(
              "-mx-1 min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-2",
              collapsed && "[scrollbar-width:none]",
            )}
          >
            {groups}
          </nav>
        </div>
      )}

      {isGuest && !collapsed && guestCard}

      <div
        className={cn(
          "flex shrink-0 items-center border-t border-sidebar-border",
          isGuest && "mt-auto",
          collapsed
            ? "-mx-2 flex-col gap-1 px-2 pt-2.5"
            : "-mx-3 gap-1 px-3 pt-2.5",
        )}
      >
        <UserMenu label={actor.label} isGuest={isGuest} variant="sidebar" />
        {/* The theme lives in Settings › Appearance for anyone with an
            account. A guest has no settings, and this is where they change
            it — as the header gives it to them on a phone. */}
        {isGuest && <ThemeToggle />}
      </div>
    </header>
  );
}

/**
 * A place in the sidebar: an icon and a name, and a count where there is one.
 *
 * Lit with the sidebar's own wash where the reader is, and marked
 * `aria-current="page"` — two cues, neither of them a colour that means
 * money. 40px tall at the desk, with the app's 44px hit area; folded, a 44px
 * square whose name is a tip and whose count sits on its corner.
 */
export function SidebarLink({
  href,
  icon,
  label,
  accessibleName,
  count,
  transitionTypes,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  /** When the name has more to say than the label — "Notifications, 4 unread". */
  accessibleName?: string;
  count?: number;
  transitionTypes?: string[];
}) {
  const pathname = usePathname();
  const { collapsed } = useSidebar();
  const isCurrent = pathname === href;

  return (
    <SidebarTip content={accessibleName ?? label}>
      <Link
        href={href}
        aria-current={isCurrent ? "page" : undefined}
        aria-label={accessibleName}
        transitionTypes={transitionTypes}
        className={cn(
          "tap-target relative flex items-center rounded-[10px] text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
          collapsed
            ? "mx-auto size-11 justify-center"
            : "h-10 gap-2.5 pr-2 pl-2.5",
          isCurrent
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-wash-2 hover:text-foreground",
        )}
      >
        {icon}
        <span className={cn("min-w-0 flex-1 truncate", collapsed && "sr-only")}>
          {label}
        </span>
        {count !== undefined && count > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              "flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-2xs font-semibold text-primary-foreground tabular-nums",
              collapsed &&
                "absolute top-0.5 right-0 h-[18px] min-w-[18px] px-1",
            )}
          >
            {count > 99 ? "99+" : count}
          </span>
        )}
      </Link>
    </SidebarTip>
  );
}

/**
 * The filled button's look, shared by every Add the sidebar offers — this
 * file's, and the group's own in `sidebar-group-add.tsx`.
 */
export function addControlClass(collapsed: boolean): string {
  return cn(
    "tap-target flex shrink-0 items-center rounded-xl bg-primary font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar focus-visible:outline-none motion-reduce:transition-none",
    collapsed
      ? "mx-auto my-1 size-11 justify-center"
      : "mt-2 mb-2.5 h-10 w-full gap-2 pr-2 pl-3 text-sm",
  );
}

/** A plus and the words, which fold away into the control's name. */
export function AddControlContent({ label }: { label: string }) {
  const { collapsed } = useSidebar();
  return (
    <>
      <Plus
        aria-hidden="true"
        strokeWidth={2.2}
        className="size-[18px] shrink-0"
      />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-left",
          collapsed && "sr-only",
        )}
      >
        {label}
      </span>
    </>
  );
}

/**
 * Add expense outside a group: it asks which group first, with the chooser
 * Home already has. With no group at all there is nothing to add an expense
 * to, and it offers to make a group instead.
 *
 * Inside a group the shell is handed the group's own Add instead — the bar's
 * link, into the drawer over the screen — which lives in its own file because
 * it reaches for the group's offline drawer, and that is the group's alone.
 */
function ChooseGroupAdd() {
  const t = useTranslations("dashboard");
  const { collapsed } = useSidebar();
  const known = useKnownGroups();
  const [choosingSince, setChoosingSince] = useState<string | null>(null);

  if (known && known.length === 0) {
    const label = t("newGroup");
    return (
      <SidebarTip content={label}>
        <Link href="/dashboard?new" className={addControlClass(collapsed)}>
          <AddControlContent label={label} />
        </Link>
      </SidebarTip>
    );
  }

  const label = t("addExpense");
  const pickable: PickableGroup[] = (known ?? [])
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      icon: entry.icon,
      iconColor: entry.iconColor,
      lastActivityAt: entry.lastActivityAt,
      participantCount: entry.participantCount,
    }))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

  return (
    <>
      <SidebarTip content={label}>
        <button
          type="button"
          aria-haspopup="dialog"
          // N presses this, outside a group; see `use-shortcuts.ts`.
          data-shortcut="n"
          onClick={() => setChoosingSince(new Date().toISOString())}
          className={addControlClass(collapsed)}
        >
          <AddControlContent label={label} />
        </button>
      </SidebarTip>
      <AddExpenseSheet
        open={choosingSince !== null}
        onOpenChange={(open) => {
          if (!open) setChoosingSince(null);
        }}
        groups={pickable}
        now={choosingSince ?? ""}
      />
    </>
  );
}

function SectionHead({ label }: { label: string }) {
  const t = useTranslations("dashboard");
  return (
    <div className="flex h-[30px] shrink-0 items-center justify-between pr-0.5 pl-2.5">
      <span className="text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </span>
      <Link
        href="/dashboard?new"
        aria-label={t("newGroup")}
        className="tap-target inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-wash-2 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
      >
        <Plus aria-hidden="true" className="size-4" />
      </Link>
    </div>
  );
}

/** The hairline the folded sidebar draws between its groups of icons. */
function Rule() {
  return (
    <span
      aria-hidden="true"
      className="mx-auto my-2.5 block h-px w-8 shrink-0 bg-sidebar-border"
    />
  );
}

/** The platform's spelling of ⌘K: a Mac's command key, everyone else's Ctrl. */
function ShortcutHint() {
  const modifier = useModifierKey();
  return <Kbd aria-hidden="true">{modifier === "⌘" ? "⌘K" : "Ctrl K"}</Kbd>;
}
