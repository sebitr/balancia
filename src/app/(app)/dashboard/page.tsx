import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import {
  NeedsYouCard,
  OwedCard,
  RecentlyActiveCard,
  Section,
  type NeedsYouView,
  type OwedView,
} from "@/components/dashboard/group-sections";
import { PositionHeader } from "@/components/dashboard/position-header";
import { SettledGroups } from "@/components/dashboard/settled-groups";
import { InstallPrompt } from "@/components/pwa/install-prompt";
import { getCurrentUser } from "@/lib/security/actor";
import {
  loadHomeOverview,
  type GroupPosition,
} from "@/modules/balances/overview";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { todayIso } from "@/modules/currencies/provider";

/**
 * Home: where you stand, then which group needs a decision, then a way in.
 *
 * Everything is resolved here, on the server. Only the settled chips and the
 * archived link are handed to a client component, so the view models below are
 * plain serialisable values — amounts as minor-unit strings, never as JS
 * numbers, and instants as ISO text.
 */

/** How many groups the all-settled screen lists as recently active. */
const RECENTLY_ACTIVE = 2;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return { title: t("metaTitle") };
}

/**
 * A group's own currency is what its row shows — `CHF 210.00` stays CHF even
 * where the header totals in EUR. The exception is a group holding balances in
 * several currencies at once, which collapses to its converted net; without a
 * rate to do that with, every figure is shown rather than one of them.
 */
function amountsOf(position: GroupPosition) {
  const amounts =
    position.amounts.length > 1 && position.net
      ? [position.net]
      : position.amounts;
  return amounts.map((amount) => ({
    minorUnits: amount.amount.toString(),
    currency: amount.currency,
  }));
}

function toNeedsYou(position: GroupPosition): NeedsYouView {
  return {
    id: position.group.id,
    name: position.group.name,
    memberNames: [...position.group.memberNames],
    participantCount: position.group.participantCount,
    lastActivityAt: position.group.lastActivityAt.toISOString(),
    amounts: amountsOf(position),
    owedTo: position.owedTo,
  };
}

function toOwed(position: GroupPosition): OwedView {
  return {
    id: position.group.id,
    name: position.group.name,
    participantCount: position.group.participantCount,
    lastActivityAt: position.group.lastActivityAt.toISOString(),
    amounts: amountsOf(position),
  };
}

export default async function DashboardPage() {
  const user = await getCurrentUser();
  // The layout has already redirected when there is no user.
  if (!user) return null;

  const t = await getTranslations("dashboard");
  const preferredCurrency = await getUserPreferredCurrency(user.userId);
  const now = new Date();
  const overview = await loadHomeOverview(user.userId, {
    preferredCurrency,
    now,
  });
  const { buckets, netPosition } = overview;

  if (overview.groupCount === 0) {
    return <FirstRun title={t("title")} subtitle={t("empty")} t={t} />;
  }

  const active = [
    ...buckets.needsYou,
    ...buckets.youAreOwed,
    ...buckets.settled,
  ].sort(
    (a, b) =>
      b.group.lastActivityAt.getTime() - a.group.lastActivityAt.getTime(),
  );

  // No group is chosen yet, so the header's action defaults to the one the
  // user touched last — the likeliest thing they are about to add to.
  const addExpenseHref = active[0]
    ? `/groups/${active[0].group.id}/expenses/new`
    : "/groups/new";

  // There is no cross-group settle screen, so this opens the settle flow of
  // the group with the largest debt: the one tap that clears the most.
  const settleUpHref = buckets.needsYou[0]
    ? `/groups/${buckets.needsYou[0].group.id}/balances`
    : null;

  const nowIso = now.toISOString();
  const allSquare =
    buckets.needsYou.length === 0 && buckets.youAreOwed.length === 0;

  return (
    <div className="-mt-6 flex flex-col">
      <h1 className="sr-only">{t("title")}</h1>

      <PositionHeader
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
        owedGroupCount={netPosition?.owedGroupCount ?? 0}
        owingGroupCount={netPosition?.owingGroupCount ?? 0}
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
        addExpenseHref={addExpenseHref}
        settleUpHref={settleUpHref}
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

      <div className="flex flex-col gap-[18px] pt-5 pb-[max(1.625rem,env(safe-area-inset-bottom))]">
        {/* The visitor already has a group, so Balancia has earned the ask.
            A brand-new account returns above, and never meets an install
            nudge on its first load. */}
        <InstallPrompt />

        {allSquare ? (
          <Section label={t("sectionRecentlyActive")}>
            <RecentlyActiveCard
              groups={active.slice(0, RECENTLY_ACTIVE).map(toOwed)}
              now={nowIso}
            />
          </Section>
        ) : (
          <>
            {buckets.needsYou.length > 0 && (
              <Section
                label={t("sectionNeedsYou")}
                count={buckets.needsYou.length}
              >
                <div className="flex flex-col gap-2.5">
                  {buckets.needsYou.map((position, index) => (
                    <NeedsYouCard
                      key={position.group.id}
                      group={toNeedsYou(position)}
                      now={nowIso}
                      urgent={index === 0}
                    />
                  ))}
                </div>
              </Section>
            )}

            {buckets.youAreOwed.length > 0 && (
              <Section
                label={t("sectionYouAreOwed")}
                count={buckets.youAreOwed.length}
              >
                <OwedCard
                  groups={buckets.youAreOwed.map(toOwed)}
                  now={nowIso}
                />
              </Section>
            )}
          </>
        )}

        <SettledGroups
          settled={buckets.settled.map((position) => ({
            id: position.group.id,
            name: position.group.name,
          }))}
          archived={buckets.archived.map((position) => ({
            id: position.group.id,
            name: position.group.name,
          }))}
        />
      </div>
    </div>
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
        <h1 className="font-heading text-[1.375rem] font-semibold tracking-[-0.02em]">
          {title}
        </h1>
        <p className="text-[0.8125rem] text-muted-foreground">{subtitle}</p>
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
          <Link href="/groups/new">
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
          href="/groups/new"
          className="shrink-0 rounded-md py-2 text-[0.8125rem] font-medium text-primary transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {t("splitwiseAction")}
        </Link>
      </div>
    </div>
  );
}
