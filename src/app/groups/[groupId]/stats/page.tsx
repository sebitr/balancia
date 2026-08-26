import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { GroupStatistics } from "@/components/groups/group-statistics";
import { requireGroupAccess } from "@/lib/actions";
import { resolveFormatPreferences } from "@/i18n/preferences";
import { loadGroupStats } from "@/modules/groups/group-stats-service";
import { listParticipants } from "@/modules/groups/service";

/**
 * A group, read as statistics.
 *
 * Reached from the "Statistics" row at the foot of the overview's spending
 * card. That card answers "what did this month come to"; this screen answers
 * the questions a total cannot — how the spending moved, who has been putting
 * it on their own card, and what it was actually spent on.
 *
 * One loader for the whole screen. Three windows, every currency and the
 * all-time records come out of the same rows, so the range switcher above
 * costs no round trip and no two blocks can disagree about when they were
 * read.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("groupStats");
  return { title: t("metaTitle") };
}

/** Faces at the top of the screen. More than this is a crowd, not a group. */
const AVATARS = 5;

export default async function GroupStatsPage({
  params,
}: PageProps<"/groups/[groupId]/stats">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [stats, people, t, tCommon, preferences] = await Promise.all([
    loadGroupStats(access),
    listParticipants(access.groupId),
    getTranslations("groupStats"),
    getTranslations("common"),
    resolveFormatPreferences(),
  ]);

  // When the group started, which is when its first person was written rather
  // than when its first expense was: a group that was set up in March and
  // recorded nothing until June has been around since March.
  const started = people.reduce<Date | null>(
    (first, person) =>
      first === null || person.createdAt < first ? person.createdAt : first,
    null,
  );
  const since = started
    ? new Intl.DateTimeFormat(preferences.formatLocale, {
        month: "long",
        year: "numeric",
        timeZone: preferences.timeZone,
      }).format(started)
    : null;

  return (
    <div className="flex flex-col gap-3.5">
      <PageHeader
        title={t("metaTitle")}
        back={{
          href: `/groups/${groupId}`,
          label: tCommon("backToGroup"),
        }}
      />

      {/* The screen is named above; this is which group it is about, which is
          why it is a heading under that one rather than the page's own. */}
      <div className="flex flex-col gap-1.5">
        <h2 className="text-2xl font-semibold tracking-[-0.025em]">
          {access.group.name}
        </h2>
        <div className="flex items-center gap-2">
          {people.length > 0 && (
            <div aria-hidden="true" className="flex shrink-0 items-center">
              {people.slice(0, AVATARS).map((person) => (
                <span
                  key={person.id}
                  className="-ml-1.5 grid size-5.5 place-items-center rounded-full bg-accent text-2xs font-semibold text-accent-foreground ring-2 ring-background first:ml-0"
                >
                  {person.displayName.trim().charAt(0).toUpperCase()}
                </span>
              ))}
            </div>
          )}
          <p className="min-w-0 truncate text-xs text-muted-foreground">
            {since
              ? t("heroMeta", { count: people.length, since })
              : t("heroMetaNoDate", { count: people.length })}
          </p>
        </div>
      </div>

      <GroupStatistics
        stats={{
          currencies: [...stats.currencies],
          firstEntry: stats.firstEntry,
          memberCount: stats.memberCount,
          ranges: stats.ranges.map((range) => ({
            key: range.key,
            granularity: range.granularity,
            months: range.months,
            currencies: range.currencies.map((entry) => ({
              currency: entry.currency,
              totalSpent: entry.totalSpent.toString(),
              netTotalSpent: entry.netTotalSpent.toString(),
              entryCount: entry.entryCount,
              medianEntry: entry.medianEntry.toString(),
              perPersonMonth: entry.perPersonMonth.toString(),
              netPerPersonMonth: entry.netPerPersonMonth.toString(),
              flows: {
                spent: entry.flows.spent.toString(),
                spentCount: entry.flows.spentCount,
                revenue: entry.flows.revenue.toString(),
                revenueCount: entry.flows.revenueCount,
                settled: entry.flows.settled.toString(),
                settledCount: entry.flows.settledCount,
              },
              buckets: entry.buckets.map((bucket) => ({
                start: bucket.start,
                amount: bucket.amount.toString(),
                entryCount: bucket.entryCount,
              })),
              bucketMean: entry.bucketMean.toString(),
              trendPercent: entry.trendPercent,
              members: entry.members.map((member) => ({
                participantId: member.participantId,
                name: member.name,
                isSelf: member.isSelf,
                paid: member.paid.toString(),
                share: member.share.toString(),
                net: member.net.toString(),
                open: member.open.toString(),
              })),
              categories: entry.categories.map((slice) => ({
                category: slice.category,
                known: slice.known,
                amount: slice.amount.toString(),
                percent: slice.percent,
                children: slice.children.map((child) => ({
                  subcategory: child.subcategory,
                  amount: child.amount.toString(),
                  percent: child.percent,
                })),
                remainder: slice.remainder.toString(),
              })),
              topThreePercent: entry.topThreePercent,
              weekdays: entry.weekdays.map((day) => ({
                weekday: day.weekday,
                entryCount: day.entryCount,
                amount: day.amount.toString(),
              })),
            })),
          })),
          records: stats.records.map((records) => ({
            currency: records.currency,
            biggestEntry: records.biggestEntry
              ? {
                  description: records.biggestEntry.description,
                  category: records.biggestEntry.category,
                  subcategory: records.biggestEntry.subcategory,
                  date: records.biggestEntry.date,
                  amount: records.biggestEntry.amount.toString(),
                  paidBy: records.biggestEntry.paidBy,
                }
              : null,
            longestOpen: records.longestOpen,
            longestSquare: records.longestSquare,
            busiestWeek: records.busiestWeek
              ? {
                  start: records.busiestWeek.start,
                  entryCount: records.busiestWeek.entryCount,
                  amount: records.busiestWeek.amount.toString(),
                }
              : null,
            quietestMonth: records.quietestMonth
              ? {
                  month: records.quietestMonth.month,
                  entryCount: records.quietestMonth.entryCount,
                  amount: records.quietestMonth.amount.toString(),
                }
              : null,
          })),
        }}
      />
    </div>
  );
}
