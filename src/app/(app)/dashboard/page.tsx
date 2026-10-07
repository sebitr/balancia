import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import { CreateGroupLauncher } from "@/components/groups/create-group-launcher";
import { Button } from "@/components/ui/button";
import {
  GroupList,
  Section,
  type GroupRowView,
} from "@/components/dashboard/group-sections";
import { PositionWidget } from "@/components/dashboard/position-widget";
import type { PickableGroup } from "@/components/dashboard/add-expense-sheet";
import { formatToday, HomeTitle } from "@/components/dashboard/home-title";
import { RecentColumn } from "@/components/dashboard/recent-column";
import { RECENT_LIMIT, toRecentRow } from "@/components/dashboard/recent-rows";
import {
  SettledGroups,
  type SettledGroupView,
} from "@/components/dashboard/settled-groups";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { NameNudge } from "@/components/dashboard/name-nudge";
import { resolveFormatPreferences } from "@/i18n/preferences";
import { getCurrentUser } from "@/lib/security/actor";
import {
  displayAmountsOf,
  loadHomeOverview,
  type GroupPosition,
} from "@/modules/balances/overview";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { isGroupIcon, isGroupIconColor } from "@/modules/groups/icons";
import { todayIso } from "@/modules/currencies/provider";
import { listNotifications } from "@/modules/notifications/service";
import {
  renderNotification,
  type Translate,
} from "@/modules/notifications/render";

/**
 * Home: where you stand, then which groups need you, then the quiet ones.
 *
 * Everything is resolved here, on the server. Only the position widget and the
 * settled line are handed to client components, so the view models below are
 * plain serialisable values — amounts as minor-unit strings, never as JS
 * numbers, and instants as ISO text.
 *
 * ## From `lg` up
 *
 * The desktop board "01 · Home", beside the sidebar. The title the phone keeps
 * for a screen reader is drawn, with today's date and how many groups are
 * open under it and New group at its right (`HomeTitle`) — the position
 * widget's own two buttons step aside there, since the sidebar carries Add
 * expense. From `xl`
 * (1280px) the groups take the left of two columns and "Recent in your
 * groups" the right; between `lg` and `xl` the second column wraps under the
 * first, inside the same readable width every other screen keeps.
 *
 * Every class that does this is `lg:` or `xl:`, and the wrappers it needs are
 * `display: contents` below those widths, so the phone's column — its order,
 * its 26px rhythm — is the one it always had.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("metaTitle") };
}

/** The group's own figures, as the serialisable pairs a row renders from. */
function amountsOf(position: GroupPosition) {
  return displayAmountsOf(position).map((amount) => ({
    minorUnits: amount.amount.toString(),
    currency: amount.currency,
  }));
}

/**
 * The stored icon, if it is still one we know how to draw.
 *
 * The column holds free text — the catalogue is not pinned in a constraint —
 * so a row written by a newer version, or by hand, resolves to no icon rather
 * than to a crash.
 */
function markOf(group: GroupPosition["group"]) {
  return {
    icon: isGroupIcon(group.icon) ? group.icon : null,
    iconColor: isGroupIconColor(group.iconColor) ? group.iconColor : null,
  };
}

/** One anatomy for both directional sections; the label supplies the sign. */
function toRow(position: GroupPosition): GroupRowView {
  return {
    ...markOf(position.group),
    id: position.group.id,
    name: position.group.name,
    memberNames: [...position.group.memberNames],
    participantCount: position.group.participantCount,
    lastActivityAt: position.group.lastActivityAt.toISOString(),
    amounts: amountsOf(position),
  };
}

function toPickable(position: GroupPosition): PickableGroup {
  return {
    ...markOf(position.group),
    id: position.group.id,
    name: position.group.name,
    lastActivityAt: position.group.lastActivityAt.toISOString(),
    participantCount: position.group.participantCount,
  };
}

/** The same row with nothing outstanding: no avatars, a word for an amount. */
function toQuiet(position: GroupPosition): SettledGroupView {
  return {
    ...markOf(position.group),
    id: position.group.id,
    name: position.group.name,
    participantCount: position.group.participantCount,
    lastActivityAt: position.group.lastActivityAt.toISOString(),
  };
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  // The layout has already redirected when there is no user.
  if (!user) return null;

  // Independent of each other; only the overview waits on the currency.
  const [t, preferredCurrency, formats] = await Promise.all([
    getTranslations("dashboard"),
    getUserPreferredCurrency(user.userId),
    resolveFormatPreferences(),
  ]);
  const now = new Date();
  const overview = await loadHomeOverview(user.userId, {
    preferredCurrency,
    now,
  });
  const { buckets, netPosition } = overview;

  /*
   * The sheet is mounted on both branches below, because both offer to create
   * a group and `?new` may arrive at either — the shortcut does not know yet
   * whether this account has any groups.
   *
   * It is the *second child of a fragment* in both, and that is load-bearing.
   * Creating the first group flips this page from one branch to the other
   * while the sheet is still open on its handover step, and React reconciles
   * by position: anywhere else in the tree, the sheet would be unmounted and
   * remounted mid-flow, throwing away the link it was in the middle of
   * offering. Keep it last, and keep both returns the same shape.
   */
  const createGroup = (
    // useSearchParams suspends; nothing under it should hold up the page.
    <Suspense fallback={null}>
      <CreateGroupLauncher
        defaultName={user.name ?? ""}
        defaultTimezone="UTC"
        // A group that does not exist yet has no habit to read, so the sheet
        // runs the preference-or-guess tail of the same chain the entry forms
        // use — on the device, which is the only place the guess can be made.
        preferredCurrency={preferredCurrency}
      />
    </Suspense>
  );

  if (overview.groupCount === 0) {
    return (
      <>
        {/* Board 20 sits lower in the window than a screen with something on
            it: 72px from the top, of which `Screen` gives 32. */}
        <div className="flex flex-col gap-4 lg:pt-10">
          <NameNudge userId={user.userId} name={user.name} />
          <FirstRun title={t("title")} subtitle={t("empty")} t={t} />
        </div>
        {createGroup}
      </>
    );
  }

  // The add-expense sheet offers these in the order it finds them, and an
  // archived group is not somewhere anyone is adding an expense.
  const active = [
    ...buckets.needsYou,
    ...buckets.youAreOwed,
    ...buckets.settled,
  ].sort(
    (a, b) =>
      b.group.lastActivityAt.getTime() - a.group.lastActivityAt.getTime(),
  );

  const nowIso = now.toISOString();

  /*
   * Nothing outstanding, split by whether anything was ever recorded. The
   * overview keeps both in one bucket — "no balance" is the same fact to the
   * arithmetic — and this screen is where they are worded apart.
   */
  const unstarted = buckets.settled.filter(
    (position) => position.hasEntries === false,
  );
  const settled = buckets.settled.filter(
    (position) => position.hasEntries !== false,
  );
  /** Every group on the screen is one nobody has recorded anything in yet. */
  const nothingRecorded =
    unstarted.length > 0 &&
    settled.length === 0 &&
    buckets.needsYou.length === 0 &&
    buckets.youAreOwed.length === 0;

  /*
   * The groups still open: everything but the settled and the archived. A
   * group nobody has recorded anything in yet counts too — it is waiting for
   * its first entry, not finished. The desktop board's "4 active groups"
   * beside two settled ones and one archived is this count.
   */
  const open =
    buckets.needsYou.length + buckets.youAreOwed.length + unstarted.length;

  return (
    <>
      <div
        // The two columns from `xl` want more than the readable column every
        // other screen keeps; `Screen` gives them up to `--app-content-max`.
        // Between `lg` and `xl` there is one column, so it keeps to that
        // readable width and centres in the room the sidebar leaves.
        data-layout="wide"
        className="flex flex-col gap-[26px] lg:mx-auto lg:w-full lg:max-w-3xl xl:max-w-none"
      >
        <HomeTitle today={formatToday(now, formats)} open={open} />

        <div className="contents xl:grid xl:grid-cols-[minmax(0,1fr)_21.25rem] xl:items-start xl:gap-8">
          <div className="contents xl:flex xl:min-w-0 xl:flex-col xl:gap-[26px]">
            <NameNudge userId={user.userId} name={user.name} />

            <PositionWidget
              net={
                netPosition
                  ? {
                      minorUnits: netPosition.net.amount.toString(),
                      currency: netPosition.net.currency,
                    }
                  : null
              }
              owedToYou={
                netPosition
                  ? {
                      minorUnits: netPosition.owedToYou.amount.toString(),
                      currency: netPosition.owedToYou.currency,
                    }
                  : null
              }
              youOwe={
                netPosition
                  ? {
                      minorUnits: netPosition.youOwe.amount.toString(),
                      currency: netPosition.youOwe.currency,
                    }
                  : null
              }
              currencyTotals={overview.currencyTotals.map((total) => ({
                currency: total.currency,
                owedToYou: total.owedToYou.amount.toString(),
                youOwe: total.youOwe.amount.toString(),
              }))}
              displayCurrency={overview.displayCurrency}
              ratesAsOf={overview.ratesAsOf}
              today={todayIso(now)}
              now={nowIso}
              converted={overview.converted}
              groups={active.map(toPickable)}
              groupCount={overview.groupCount}
              unstarted={nothingRecorded ? { count: unstarted.length } : null}
              lastCleared={
                overview.lastCleared
                  ? {
                      at: overview.lastCleared.at.toISOString(),
                      groupName: overview.lastCleared.groupName,
                    }
                  : null
              }
            />

            {/* The bottom inset clears a phone's home indicator. Beside the
                sidebar there is none, `Screen` pads the foot, and between
                `lg` and `xl` the recent column follows straight on. */}
            <div className="flex flex-col gap-[26px] pb-[max(2.125rem,env(safe-area-inset-bottom))] lg:pb-0">
              {/* The visitor already has a group, so Balancia has earned the
                  ask. A brand-new account returns above, and never meets an
                  install nudge on its first load. */}
              <InstallPrompt />

              {/* This label has to stay neutral about direction, in every
                  language. `directionOf` files a group holding a debt in one
                  currency and a credit in another under this section on
                  purpose — without a rate it has no single sign, and
                  prompting someone to look is the harmless mistake. Its row
                  still shows both figures, so a heading that says "you owe
                  money" is contradicted by the green number underneath it.
                  "Needs you" is not; the French said "Tu dois de l'argent"
                  and was. */}
              {buckets.needsYou.length > 0 && (
                <Section label={t("sectionNeedsYou")}>
                  <GroupList
                    groups={buckets.needsYou.map(toRow)}
                    now={nowIso}
                  />
                </Section>
              )}

              {buckets.youAreOwed.length > 0 && (
                <Section label={t("sectionYouAreOwed")}>
                  <GroupList
                    groups={buckets.youAreOwed.map(toRow)}
                    now={nowIso}
                  />
                </Section>
              )}

              <SettledGroups
                unstarted={unstarted.map(toQuiet)}
                settled={settled.map(toQuiet)}
                archived={buckets.archived.map(toQuiet)}
                now={nowIso}
              />
            </div>
          </div>

          {/* Streamed: it is the one thing on the screen that is not about
              the groups, and the groups should not wait for it. Drawn from
              `lg` only — see `RecentColumn`. */}
          <Suspense fallback={null}>
            <RecentInYourGroups userId={user.userId} now={now} />
          </Suspense>
        </div>
      </div>
      {createGroup}
    </>
  );
}

/**
 * Home's right-hand column on a desktop: the head of the reader's inbox.
 *
 * One read, the inbox's own (`listNotifications`, by the index on the
 * reader and the time), and the inbox's own wording — see `recent-rows.ts`.
 * It is made on a phone too, where the column is not drawn: the server
 * cannot know the width, and five rows by index is cheaper than a second
 * request to find out.
 */
async function RecentInYourGroups({
  userId,
  now,
}: {
  userId: string;
  now: Date;
}) {
  const [t, tPage, locale, formats, entries] = await Promise.all([
    getTranslations("notifications") as Promise<Translate>,
    getTranslations("notificationsPage"),
    getLocale(),
    resolveFormatPreferences(),
    listNotifications(userId, { limit: RECENT_LIMIT }),
  ]);

  const rows = entries.map((entry) =>
    toRecentRow(
      entry,
      renderNotification(entry, t, locale, {
        numberLocale: formats.numberLocale,
      }),
      (name) => tPage("reminderFrom", { name }),
    ),
  );

  return <RecentColumn rows={rows} now={now.toISOString()} />;
}

/**
 * First run. With no position to show, the editorial header gives way to an
 * ordinary title — and the one thing a new account might already have is a
 * Splitwise export, so that gets its own row rather than a buried link.
 *
 * From `lg`, the desktop board "20 · No groups yet": the same one column and
 * the same words, centred beside the sidebar with room above it, the title at
 * the size every desktop screen's title has, and the invitation on the card's
 * own surface. Nothing is added — the sidebar already says, in its group list,
 * that a group made or joined turns up there.
 */
function FirstRun({
  title,
  subtitle,
  t,
}: {
  title: string;
  subtitle: string;
  t: Awaited<ReturnType<typeof getTranslations<"dashboard">>>;
}) {
  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="space-y-0.5">
        <h1 className="font-heading text-xl font-semibold tracking-[-0.02em] lg:text-2xl">
          {title}
        </h1>
        <p className="text-xs text-muted-foreground lg:text-sm">{subtitle}</p>
      </div>

      <div className="flex flex-col items-center gap-[11px] rounded-[17px] border border-dashed px-5 py-8 text-center lg:bg-card lg:py-14">
        <span className="flex size-[46px] items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Users aria-hidden="true" className="size-[21px]" />
        </span>
        <h2 className="text-base font-medium">{t("emptyTitle")}</h2>
        <p className="max-w-[260px] text-sm leading-[1.55] text-pretty text-muted-foreground lg:max-w-sm">
          {t("emptyDescription")}
        </p>
        <Button asChild className="mt-1 h-[38px] rounded-xl lg:h-10">
          {/* Opens the sheet on this page rather than pushing a screen. */}
          <Link href="?new" replace scroll={false}>
            <Plus aria-hidden="true" />
            {t("createGroup")}
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-[17px] bg-card px-4 py-[13px] ring-1 ring-border">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium">{t("splitwiseTitle")}</span>
          <span className="text-xs text-muted-foreground">
            {t("splitwiseSubtitle")}
          </span>
        </span>
        {/* Importing needs somewhere to import *into*, and there are no groups
            yet — so this starts where it has to, at creating one. */}
        <Link
          href="?new"
          replace
          scroll={false}
          className="shrink-0 rounded-md py-2 text-xs font-medium text-primary-ink transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t("splitwiseAction")}
        </Link>
      </div>
    </div>
  );
}
