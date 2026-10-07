import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { getDateFormatter } from "@/i18n/preferences";
import { Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Amount } from "@/components/money/amount";
import { RecurringRowActions } from "@/components/recurring/recurring-row-actions";
import {
  RecurringTable,
  type RecurringRowView,
} from "@/components/recurring/recurring-table";
import {
  scheduleSentence,
  weekdayName,
} from "@/components/recurring/schedule-sentence";
import {
  REPEAT_PARAM,
  withFragment,
} from "@/components/entries/drawer-fragment";
import { PageHeader } from "@/components/ui/page-header";
import { requireGroupAccess } from "@/lib/actions";
import { listRecurringExpenses } from "@/modules/recurring/service";
import { listParticipants } from "@/modules/groups/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("recurringPage");
  return { title: t("title") };
}

/**
 * A group's recurring expenses, and the way to add one.
 *
 * Adding is the entry form, opened with Repeats on. This screen used to carry
 * a form of its own — weekly, monthly or yearly, split equally — which could
 * do less than the entry form's Repeats could and worded the same rule
 * differently, so a reader met two ways to set one rule up with two sets of
 * abilities. Now there is one: the button below opens the form, and the row
 * menu's Edit reopens it on a rule.
 *
 * Reached from the transactions list, beside its kind chips, and from the
 * shortcut at the foot of the group's settings. The way back is to whichever
 * one it was — the settings row says so in its link.
 *
 * The rules are read once and worded once, into `RecurringRowView`s, and laid
 * out twice: as the phone's list below `lg`, and as `RecurringTable` from
 * there up. Both are in the HTML and CSS shows one, `display: none` keeping
 * the other out of the accessibility tree too. The transactions screen mounts
 * only the renderer the window can see, because it can hold thousands of
 * rows; a group's recurring expenses are a handful, and drawing them twice on
 * the server costs less than a client island would.
 */
export default async function RecurringPage({
  params,
  searchParams,
}: PageProps<"/groups/[groupId]/recurring">) {
  const { groupId } = await params;
  const { from } = await searchParams;
  const access = await requireGroupAccess(groupId);

  const [templates, participants] = await Promise.all([
    listRecurringExpenses(access.groupId),
    listParticipants(access.groupId),
  ]);

  const t = await getTranslations("recurringPage");
  const tCommon = await getTranslations("common");
  const tSchedule = await getTranslations("recurring.schedule");
  const dates = await getDateFormatter();
  const locale = await getLocale();

  /** The rule in the words the repeat sheet and the entry form use. */
  const describeSchedule = (template: (typeof templates)[number]): string => {
    const sentence = scheduleSentence(template, {
      weekday: (day) => weekdayName(locale, day),
      week: (week) => tSchedule(`week.${week}`),
      dayMonth: (day) => dates.plain(day, "dayMonth"),
    });
    return tSchedule(sentence.key, sentence.values);
  };

  const rows: RecurringRowView[] = templates.map((template) => ({
    id: template.id,
    description: template.description,
    amount: template.amount.toString(),
    currency: template.currency,
    schedule: describeSchedule(template),
    next:
      template.nextRunAt && !template.pausedAt
        ? // On the group's calendar, where the schedule runs. The server's
          // clock put a Sydney group's 09:00 on the evening before.
          dates.at(template.nextRunAt, { timeZone: access.group.timezone })
        : null,
    paused: template.pausedAt !== null,
    generatedCount: template.generatedCount,
  }));

  // Nothing to split a new one between until the group has people.
  const canAdd = access.permissions.manageRecurring && participants.length > 0;
  const addHref = withFragment(`/groups/${groupId}/expenses/new`, {
    [REPEAT_PARAM]: "1",
  });
  const addButton = canAdd ? (
    <Button asChild className="w-full sm:w-auto">
      {/* No direction, like the bar's own Add: it opens a drawer over this
          list rather than going anywhere. */}
      <Link href={addHref}>
        <Plus aria-hidden="true" />
        {t("add")}
      </Link>
    </Button>
  ) : null;

  const back =
    from === "settings"
      ? {
          href: `/groups/${groupId}/settings`,
          label: tCommon("backToGroupSettings"),
        }
      : {
          href: `/groups/${groupId}/expenses`,
          label: tCommon("backToTransactions"),
        };

  const listed = rows.length > 0;

  return (
    // `data-layout="wide"` asks the screen for the room the table needs from
    // `lg` up, only when there is a table; the empty state keeps the readable
    // column. Below `lg` the screen does not read it.
    <div data-layout={listed ? "wide" : undefined} className="space-y-6">
      <div>
        <PageHeader
          title={t("title")}
          back={back}
          // From `lg` up the button stands at the end of the title's row, as
          // the board draws it, and the one under the list is not drawn: the
          // table can run longer than the window, and the way to add one
          // should not be at the bottom of it. Only one of the two is ever
          // displayed, so a screen reader meets one.
          trailing={
            listed && addButton ? (
              <div className="hidden shrink-0 lg:block">{addButton}</div>
            ) : undefined
          }
        />
        <p className="pl-10.5 text-sm text-muted-foreground">
          {t("intro", { timezone: access.group.timezone })}
        </p>
      </div>

      {!listed ? (
        <EmptyState
          icon={RefreshCw}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={addButton}
        />
      ) : (
        <>
          <ul className="divide-y rounded-lg border lg:hidden">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{row.description}</span>
                    {row.paused && (
                      <Badge variant="secondary">{t("pausedBadge")}</Badge>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <Amount minorUnits={row.amount} currency={row.currency} /> ·{" "}
                    {row.schedule}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {row.next !== null
                      ? t("next", { date: row.next })
                      : row.paused
                        ? t("pausedNote")
                        : t("noFurther")}
                    {row.generatedCount > 0 &&
                      ` · ${t("generatedSoFar", {
                        count: row.generatedCount,
                      })}`}
                  </p>
                </div>
                <RecurringRowActions
                  groupId={groupId}
                  templateId={row.id}
                  description={row.description}
                  paused={row.paused}
                  canEdit={canAdd}
                />
              </li>
            ))}
          </ul>
          <RecurringTable
            rows={rows}
            groupId={groupId}
            canEdit={canAdd}
            className="hidden lg:block"
          />
          {addButton && <div className="lg:hidden">{addButton}</div>}
        </>
      )}
    </div>
  );
}
