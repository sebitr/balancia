"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, ChevronRight, House } from "lucide-react";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { GroupIconTile } from "@/components/groups/group-icon";
import { Skeleton } from "@/components/ui/skeleton";
import { POP, SWITCH_FORWARD } from "@/components/motion/transitions";
import { useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";
import {
  loadSwitcherGroups,
  type SwitcherGroup,
} from "@/modules/balances/actions";
import { BalanciaMark } from "@/components/brand/wordmark";
import { cn } from "@/lib/utils";

/**
 * The left of the header on a group screen: the way out, and the way sideways.
 *
 * Two controls, and the difference between them is the difference between the
 * product and the group. The mark goes home, the way a logo does everywhere
 * else on the web. The name opens a panel holding every other group — every
 * slot on the bottom bar is scoped to the group you are trying to leave, so
 * without it moving between two active groups cost three taps.
 *
 * The mark and no wordmark: the name beside it is the group's, and two names
 * in a row would read as one titling the other.
 *
 * The name is already loaded by the group layout, so the header costs nothing
 * until the panel is opened. What the panel needs beyond the name — every
 * group and where you stand in each — is fetched then, not now.
 */

/**
 * Sections a switch can land on, so it keeps the screen you were looking at.
 *
 * `import` is deliberately absent: it is the one section that 404s outright
 * where the actor cannot import, so carrying it across would drop an owner
 * into a dead end in the group they are merely a member of. It falls back to
 * that group's overview instead.
 */
const GROUP_SECTIONS = [
  "expenses",
  "members",
  "settings",
  "balances",
  "activity",
  "recurring",
] as const;

/**
 * The same screen, in another group.
 *
 * Only the section survives the move: a path any deeper names a row — an
 * expense, a participant — that belongs to the group being left and has no
 * counterpart in the one being entered. Anything unrecognised lands on the
 * overview, which every group has.
 */
export function equivalentPath(
  pathname: string,
  fromGroupId: string,
  toGroupId: string,
): string {
  const destination = `/groups/${toGroupId}`;
  const base = `/groups/${fromGroupId}`;
  if (!pathname.startsWith(base)) return destination;

  const [section] = pathname.slice(base.length).split("/").filter(Boolean);
  return section && (GROUP_SECTIONS as readonly string[]).includes(section)
    ? `${destination}/${section}`
    : destination;
}

export function GroupSwitcher({
  groupId,
  groupName,
  isGuest,
}: {
  groupId: string;
  groupName: string;
  isGuest: boolean;
}) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const [groups, setGroups] = useState<SwitcherGroup[] | null>(null);
  const [failed, setFailed] = useState(false);

  /*
   * Openness is remembered as the screen it was opened on, rather than as a
   * flag. A route change then closes the panel by arithmetic — including the
   * navigations it starts itself — with nothing left to keep in step.
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;
  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  useEffect(() => {
    if (!open || groups || failed) return;
    let current = true;
    loadSwitcherGroups().then(
      (loaded) => current && setGroups(loaded),
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [open, groups, failed]);

  /*
   * A guest belongs to one group and has no dashboard behind it, so there is
   * nowhere to go out to and nowhere to go sideways. The mark stays as a mark
   * and the name stays as text: nothing here is focusable, so the keyboard
   * passes straight over both.
   */
  if (isGuest) {
    return (
      <span className="flex min-w-0 items-center gap-2">
        <BalanciaMark className="size-6 shrink-0" />
        <span className="truncate text-base font-semibold tracking-[-0.01em]">
          {groupName}
        </span>
      </span>
    );
  }

  /*
   * The mark is the way home, and it is the mark rather than the wordmark
   * because the name beside it is the group's — two names in a row, one of
   * them the product's, would read as a title for the other.
   *
   * The negative margin is alignment: the mark's box is wider than the mark,
   * so pulling it back over the header's padding stands the glyph itself on
   * the column's edge rather than the whitespace around it.
   */
  return (
    // `flex-1`, so the name is handed every pixel the icon cluster opposite is
    // not using rather than only the ones it happens to be left with.
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <Link
        href="/dashboard"
        transitionTypes={POP}
        aria-label={t("home")}
        className="tap-target -ml-2 inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-foreground transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
      >
        <BalanciaMark className="size-6" />
      </Link>

      <Popover open={open} onOpenChange={setOpen}>
        {/* The padding and gaps here are tight on purpose. On a 375px phone
            this row has 343px to divide between a mark, a name, a chevron and
            three icons, and "Colocation Genève" was losing its last two
            letters to a seven-pixel shortfall — a name that fits, ellipsed for
            want of the padding around it. Between this, the `gap-0.5` above
            and the `flex-1`, a name has eight more pixels than it did.

            A genuinely long name still truncates, which is correct: the header
            is a secondary display of a name the page states in full in its
            `h1`, and this trigger opens a panel that spells it out. */}
        <PopoverTrigger className="tap-target group/trigger inline-flex h-[34px] min-w-0 items-center gap-1 rounded-xl px-1.5 transition-colors duration-[140ms] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:bg-accent motion-reduce:transition-none">
          <span className="truncate text-base font-semibold tracking-[-0.01em]">
            {groupName}
          </span>
          <ChevronDown
            aria-hidden="true"
            strokeWidth={2.2}
            className="size-[15px] shrink-0 text-muted-foreground transition-transform duration-[160ms] group-data-[state=open]/trigger:rotate-180 motion-reduce:transition-none"
          />
        </PopoverTrigger>

        {/* Anchored to the header row rather than to the name, so the panel
          spans the header's width instead of the trigger's. It comes after
          the trigger because the last anchor mounted is the one Radix keeps:
          declared first, the trigger's own anchor would win instead. */}
        <PopoverAnchor asChild>
          <span aria-hidden="true" className="absolute inset-x-0 bottom-0" />
        </PopoverAnchor>

        <Scrim open={open} />

        <PopoverContent
          align="start"
          alignOffset={12}
          sideOffset={2}
          collisionPadding={12}
          aria-label={t("yourGroups")}
          className="w-[calc(var(--radix-popover-trigger-width)-24px)] gap-0 overflow-hidden rounded-[17px] p-0 shadow-[0_12px_28px_-8px_rgb(0_0_0/0.45)] motion-reduce:animate-none"
        >
          <span className="px-3.5 pt-[11px] pb-[7px] text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            {t("yourGroups")}
          </span>

          {/* Six rows of groups before this scrolls; the way to the dashboard
            below stays put rather than scrolling out of reach. */}
          <div className="max-h-[min(21.75rem,50vh)] min-h-0 overflow-y-auto overscroll-contain">
            {groups ? (
              <GroupRows
                groups={groups}
                groupId={groupId}
                groupName={groupName}
                pathname={pathname}
              />
            ) : failed ? (
              <button
                type="button"
                onClick={() => {
                  setFailed(false);
                }}
                className="flex w-full items-center border-t px-3.5 py-2.5 text-left text-sm text-muted-foreground transition-colors hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
              >
                {t("switcherRetry")}
              </button>
            ) : (
              <LoadingRows />
            )}
          </div>

          <Link
            href="/dashboard"
            transitionTypes={POP}
            className="flex items-center gap-2.5 border-t px-3.5 py-2.5 transition-colors hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            <House
              aria-hidden="true"
              strokeWidth={1.9}
              className="size-[17px] shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 flex-1 text-sm font-medium">
              {t("switcherDashboard")}
              <span className="font-normal text-muted-foreground">
                {" · "}
                {t("switcherAllGroups")}
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-[15px] shrink-0 text-muted-foreground"
            />
          </Link>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * The dim behind the panel.
 *
 * Portalled to the body and left under the header's own layer, so the control
 * that opened the panel stays lit while the screen below it recedes. Radix
 * treats a press here as a press outside the panel, which is what dismisses
 * it — the scrim itself handles nothing.
 */
function Scrim({ open }: { open: boolean }) {
  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-hidden="true"
      className="fixed inset-0 z-30 animate-in bg-foreground/20 duration-150 fade-in-0 motion-reduce:animate-none"
    />,
    document.body,
  );
}

function LoadingRows() {
  return (
    <div aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex items-center gap-2.5 border-t px-3.5 py-2.5"
        >
          <Skeleton className="size-7 rounded-[9px]" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupRows({
  groups,
  groupId,
  groupName,
  pathname,
}: {
  groups: readonly SwitcherGroup[];
  groupId: string;
  groupName: string;
  pathname: string;
}) {
  /*
   * The group being viewed is always in the list, even when the list does not
   * contain it — an archived group is left out of the switcher but can still
   * be the one you are standing in, and a panel that failed to mark anywhere
   * as current would be worse than one extra row.
   */
  const rows = groups.some((group) => group.id === groupId)
    ? groups
    : [
        {
          id: groupId,
          name: groupName,
          icon: null,
          iconColor: null,
          direction: "settled" as const,
          amounts: [],
        },
        ...groups,
      ];

  return rows.map((group) => (
    <GroupRow
      key={group.id}
      group={group}
      isCurrent={group.id === groupId}
      href={equivalentPath(pathname, groupId, group.id)}
    />
  ));
}

function GroupRow({
  group,
  isCurrent,
  href,
}: {
  group: SwitcherGroup;
  isCurrent: boolean;
  href: string;
}) {
  const t = useTranslations("nav");
  const locale = useNumberLocale();

  const position = isCurrent
    ? t("youAreHere")
    : group.amounts.length === 0
      ? t("switcherSettled")
      : t(
          group.direction === "owed" ? "switcherYouAreOwed" : "switcherYouOwe",
          {
            amount: group.amounts
              .map((amount) =>
                formatMoney(money(BigInt(amount.minorUnits), amount.currency), {
                  locale,
                }),
              )
              .join(" · "),
          },
        );

  return (
    <Link
      href={href}
      // Another group is a peer, not a place inside this one: the screen moves
      // sideways rather than deeper.
      transitionTypes={SWITCH_FORWARD}
      aria-current={isCurrent ? "true" : undefined}
      className={cn(
        "flex items-center gap-2.5 border-t px-3.5 py-2.5 transition-colors hover:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
        isCurrent && "bg-foreground/[0.05]",
      )}
    >
      <GroupIconTile
        icon={group.icon}
        color={group.iconColor}
        name={group.name}
        muted={isCurrent}
        className={cn(
          "size-7 rounded-[9px] text-2xs font-semibold",
          isCurrent
            ? "bg-primary text-primary-foreground"
            : "bg-accent text-accent-foreground",
        )}
        iconClassName="size-[15px]"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{group.name}</span>
        <span className="truncate text-2xs text-muted-foreground tabular-nums">
          {position}
        </span>
      </span>
      {isCurrent && (
        <Check
          aria-hidden="true"
          strokeWidth={2.4}
          className="size-4 shrink-0 text-primary-ink"
        />
      )}
    </Link>
  );
}
