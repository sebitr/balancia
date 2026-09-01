import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { CreateGroupLauncher } from "@/components/groups/create-group-launcher";
import { Button } from "@/components/ui/button";
import {
  GroupList,
  Section,
  type GroupRowView,
} from "@/components/dashboard/group-sections";
import { PositionWidget } from "@/components/dashboard/position-widget";
import type { PickableGroup } from "@/components/dashboard/add-expense-sheet";
import {
  SettledGroups,
  type SettledGroupView,
} from "@/components/dashboard/settled-groups";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { getCurrentUser } from "@/lib/security/actor";
import {
  displayAmountsOf,
  loadHomeOverview,
  type GroupPosition,
} from "@/modules/balances/overview";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { defaultCurrency } from "@/modules/currencies/default-currency";
import { isGroupIcon, isGroupIconColor } from "@/modules/groups/icons";
import { todayIso } from "@/modules/currencies/provider";

/**
 * Home: where you stand, then which groups need you, then the quiet ones.
 *
 * Everything is resolved here, on the server. Only the position widget and the
 * settled line are handed to client components, so the view models below are
 * plain serialisable values — amounts as minor-unit strings, never as JS
 * numbers, and instants as ISO text.
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
  const [t, preferredCurrency] = await Promise.all([
    getTranslations("dashboard"),
    getUserPreferredCurrency(user.userId),
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
        // A group that does not exist yet has no habit to read, so this is the
        // preference-or-guess tail of the same chain the entry forms use.
        defaultCurrency={defaultCurrency({ preferred: preferredCurrency })}
      />
    </Suspense>
  );

  if (overview.groupCount === 0) {
    return (
      <>
        <FirstRun title={t("title")} subtitle={t("empty")} t={t} />
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

  return (
    <>
      <div className="flex flex-col gap-[26px]">
        <h1 className="sr-only">{t("title")}</h1>

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
          lastCleared={
            overview.lastCleared
              ? {
                  at: overview.lastCleared.at.toISOString(),
                  groupName: overview.lastCleared.groupName,
                }
              : null
          }
        />

        <div className="flex flex-col gap-[26px] pb-[max(2.125rem,env(safe-area-inset-bottom))]">
          {/* The visitor already has a group, so Balancia has earned the ask.
            A brand-new account returns above, and never meets an install
            nudge on its first load. */}
          <InstallPrompt />

          {/* This label has to stay neutral about direction, in every
              language. `directionOf` files a group holding a debt in one
              currency and a credit in another under this section on purpose —
              without a rate it has no single sign, and prompting someone to
              look is the harmless mistake. Its row still shows both figures,
              so a heading that says "you owe money" is contradicted by the
              green number underneath it. "Needs you" is not; the French said
              "Tu dois de l'argent" and was. */}
          {buckets.needsYou.length > 0 && (
            <Section label={t("sectionNeedsYou")}>
              <GroupList groups={buckets.needsYou.map(toRow)} now={nowIso} />
            </Section>
          )}

          {buckets.youAreOwed.length > 0 && (
            <Section label={t("sectionYouAreOwed")}>
              <GroupList groups={buckets.youAreOwed.map(toRow)} now={nowIso} />
            </Section>
          )}

          <SettledGroups
            settled={buckets.settled.map(toQuiet)}
            archived={buckets.archived.map(toQuiet)}
            now={nowIso}
          />
        </div>
      </div>
      {createGroup}
    </>
  );
}

/**
 * First run. With no position to show, the editorial header gives way to an
 * ordinary title — and the one thing a new account might already have is a
 * Splitwise export, so that gets its own row rather than a buried link.
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
    <div className="flex flex-col gap-4">
      <div className="space-y-0.5">
        <h1 className="font-heading text-xl font-semibold tracking-[-0.02em]">
          {title}
        </h1>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>

      <div className="flex flex-col items-center gap-[11px] rounded-[17px] border border-dashed px-5 py-8 text-center">
        <span className="flex size-[46px] items-center justify-center rounded-full bg-accent text-accent-foreground">
          <Users aria-hidden="true" className="size-[21px]" />
        </span>
        <h2 className="text-base font-medium">{t("emptyTitle")}</h2>
        <p className="max-w-[260px] text-sm leading-[1.55] text-pretty text-muted-foreground">
          {t("emptyDescription")}
        </p>
        <Button asChild className="mt-1 h-[38px] rounded-xl">
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
