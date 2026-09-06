import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { MemberPosition } from "@/components/members/member-position";
import { MemberStatistics } from "@/components/members/member-statistics";
import { requireGroupAccess } from "@/lib/actions";
import { getDateFormatter } from "@/i18n/preferences";
import { loadGroupBalances } from "@/modules/balances/service";
import { counterpartiesOf } from "@/modules/groups/overview";
import { loadMemberStats } from "@/modules/groups/member-stats-service";
import { listParticipants } from "@/modules/groups/service";

/**
 * One member, read as statistics.
 *
 * Reached from a row of "Everyone's balance" on the overview. That row already
 * answers "how much" in one signed number; this screen answers the questions
 * the number cannot — what they put in against what was theirs to carry, how
 * that has moved, where it went, and who they keep sharing entries with.
 *
 * The same screen serves the reader's own row, in the second person. Nothing
 * about the data changes: a group's balances are shared by definition, and a
 * statistic about somebody else is one they can read about themselves.
 *
 * The position at the top is read from `loadGroupBalances` rather than derived
 * here — one place in this codebase turns facts into a balance, and it is not
 * a screen.
 */

export async function generateMetadata({
  params,
}: PageProps<"/groups/[groupId]/members/[participantId]">): Promise<Metadata> {
  const { groupId, participantId } = await params;
  const access = await requireGroupAccess(groupId);
  const people = await listParticipants(access.groupId, {
    includeRemoved: true,
  });
  const person = people.find((candidate) => candidate.id === participantId);
  if (!person) notFound();
  return { title: person.displayName };
}

export default async function MemberStatsPage({
  params,
}: PageProps<"/groups/[groupId]/members/[participantId]">) {
  const { groupId, participantId } = await params;
  const access = await requireGroupAccess(groupId);

  // Removed people included: they keep the entries they were on, and a row on
  // the overview that still shows their balance has to lead somewhere.
  const people = await listParticipants(access.groupId, {
    includeRemoved: true,
  });
  const person = people.find((candidate) => candidate.id === participantId);
  if (!person) notFound();

  const [balances, stats, t, tCommon, dates] = await Promise.all([
    loadGroupBalances(access),
    loadMemberStats(access, participantId),
    getTranslations("memberStats"),
    getTranslations("common"),
    getDateFormatter(),
  ]);

  const self = access.participantId;
  const viewingSelf = self === participantId;
  const name = person.displayName;

  /*
   * The position, per currency: what they are net, who would pay them and who
   * they would pay, and — when somebody else is reading — the one transfer
   * that stands between the two of them.
   *
   * Counterparties come off the simplified debts rather than off the raw
   * balances, for the same reason the overview does it: "who do I settle with"
   * has a shorter answer than "who has ever owed whom".
   */
  const positions = balances.currencies
    .map((entry) => {
      const net =
        entry.balances.find(
          (balance) => balance.participantId === participantId,
        )?.amount ?? 0n;
      const suggestions =
        balances.suggestionsByCurrency.get(entry.currency) ?? [];
      const counterparties = counterpartiesOf(
        suggestions,
        participantId,
        balances.participantNames,
      );
      const incoming = suggestions.filter(
        (one) => one.toParticipantId === participantId,
      );
      const outgoing = suggestions.filter(
        (one) => one.fromParticipantId === participantId,
      );
      const sum = (rows: readonly { amount: bigint }[]) =>
        rows.reduce((total, row) => total + row.amount, 0n);

      // Between the reader and this member, signed the reader's way: positive
      // means the member would be paying them.
      const between = self
        ? sum(outgoing.filter((one) => one.toParticipantId === self)) -
          sum(incoming.filter((one) => one.fromParticipantId === self))
        : 0n;

      // Whoever they owe the most, which is the name worth putting in the
      // sentence when there is only one of them to name.
      const largestDebt = [...outgoing].sort((a, b) =>
        b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : 0,
      )[0];

      return {
        currency: entry.currency,
        net: net.toString(),
        between: between.toString(),
        owedBy: sum(incoming).toString(),
        owes: sum(outgoing).toString(),
        owedByCount: incoming.length,
        owesCount: outgoing.length,
        openCount: counterparties.length,
        openTotal: sum(counterparties).toString(),
        largestDebtTo: largestDebt
          ? (balances.participantNames.get(largestDebt.toParticipantId) ?? "")
          : null,
      };
    })
    // A currency this person has never appeared in is not a position of
    // theirs; it is somebody else's, listed under a heading with their name.
    .filter(
      (position) =>
        position.net !== "0" ||
        position.openCount > 0 ||
        stats.currencies.includes(position.currency),
    );

  return (
    <div className="flex flex-col gap-3.5">
      {/* The screen is the person, so the person is its title — named beside
          the arrow like every other pushed screen, and named rather than
          addressed: the reader's own screen used to be headed "You" while the
          badge beside it said the same word again. Second person belongs in
          the sentences below, which is where it still is. */}
      <div className="flex flex-col gap-0.5">
        <PageHeader
          title={name}
          back={{ href: `/groups/${groupId}`, label: tCommon("backToGroup") }}
          badge={
            <span className="inline-flex h-[19px] shrink-0 items-center rounded-full bg-secondary px-2 text-2xs font-semibold text-secondary-foreground">
              {viewingSelf
                ? t("badgeYou")
                : person.role === "owner"
                  ? t("badgeOwner")
                  : person.role === "guest"
                    ? t("badgeGuest")
                    : t("badgeMember")}
            </span>
          }
        />
        {/* Indented past the arrow, so it reads as a line under the words
            rather than under the way back. */}
        <p className="truncate pl-10.5 text-xs text-muted-foreground">
          {t("joined", {
            group: access.group.name,
            date: dates.at(person.createdAt),
          })}
        </p>
      </div>

      {positions.map((position) => (
        <MemberPosition
          key={position.currency}
          position={position}
          groupName={access.group.name}
          name={name}
          // Three readers, three headlines: your own row is your net, somebody
          // else's is the one figure between the two of you, and a guest with
          // no participant row of their own has no "between" to show.
          mode={viewingSelf ? "self" : self ? "between" : "member"}
        />
      ))}

      <MemberStatistics
        name={name}
        viewingSelf={viewingSelf}
        stats={{
          currencies: [...stats.currencies],
          firstEntry: stats.firstEntry,
          ranges: stats.ranges.map((range) => ({
            key: range.key,
            granularity: range.granularity,
            months: range.months,
            currencies: range.currencies.map((entry) => ({
              currency: entry.currency,
              paid: entry.paid.toString(),
              share: entry.share.toString(),
              entryCount: entry.entryCount,
              groupSpent: entry.groupSpent.toString(),
              payerIndex: entry.payerIndex,
              sharePercent: entry.sharePercent,
              rank: entry.rank,
              evenPercent: entry.evenPercent,
              medianPercent: entry.medianPercent,
              members: entry.members.map((member) => ({
                participantId: member.participantId,
                name: member.name,
                percent: member.percent,
                isSubject: member.isSubject,
              })),
              buckets: entry.buckets.map((bucket) => ({
                start: bucket.start,
                paid: bucket.paid.toString(),
                share: bucket.share.toString(),
              })),
              categories: entry.categories.map((slice) => ({
                category: slice.category,
                amount: slice.amount.toString(),
                percent: slice.percent,
              })),
              partners: entry.partners.map((partner) => ({
                participantId: partner.participantId,
                name: partner.name,
                entryCount: partner.entryCount,
                amount: partner.amount.toString(),
              })),
              topPartnerPercent: entry.topPartnerPercent,
            })),
          })),
          activity: {
            longestRun: stats.activity.longestRun,
            currentRun: stats.activity.currentRun,
            days: stats.activity.days.map((day) => ({
              date: day.date,
              count: day.count,
              amounts: day.amounts.map((entry) => ({
                currency: entry.currency,
                amount: entry.amount.toString(),
              })),
            })),
          },
          records: stats.records.map((record) => ({
            currency: record.currency,
            biggestBill: record.biggestBill
              ? {
                  description: record.biggestBill.description,
                  category: record.biggestBill.category,
                  date: record.biggestBill.date,
                  amount: record.biggestBill.amount.toString(),
                }
              : null,
            longestDebt: record.longestDebt,
            fastestSettle: record.fastestSettle,
            quietestMonth: record.quietestMonth
              ? {
                  month: record.quietestMonth.month,
                  entryCount: record.quietestMonth.entryCount,
                  amount: record.quietestMonth.amount.toString(),
                }
              : null,
          })),
        }}
      />
    </div>
  );
}
