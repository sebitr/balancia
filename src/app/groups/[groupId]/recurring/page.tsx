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

  return (
    <div className="space-y-6">
      <div>
        <PageHeader title={t("title")} back={back} />
        <p className="pl-10.5 text-sm text-muted-foreground">
          {t("intro", { timezone: access.group.timezone })}
        </p>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={addButton}
        />
      ) : (
        <>
          <ul className="divide-y rounded-lg border">
            {templates.map((template) => (
              <li
                key={template.id}
                className="flex items-start justify-between gap-3 p-3"
              >
                <div className="min-w-0 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    <span className="truncate">{template.description}</span>
                    {template.pausedAt && (
                      <Badge variant="secondary">{t("pausedBadge")}</Badge>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <Amount
                      minorUnits={template.amount.toString()}
                      currency={template.currency}
                    />{" "}
                    · {describeSchedule(template)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {template.nextRunAt && !template.pausedAt
                      ? t("next", {
                          // On the group's calendar, where the schedule runs.
                          // The server's clock put a Sydney group's 09:00 on
                          // the evening before.
                          date: dates.at(template.nextRunAt, {
                            timeZone: access.group.timezone,
                          }),
                        })
                      : template.pausedAt
                        ? t("pausedNote")
                        : t("noFurther")}
                    {template.generatedCount > 0 &&
                      ` · ${t("generatedSoFar", {
                        count: template.generatedCount,
                      })}`}
                  </p>
                </div>
                <RecurringRowActions
                  groupId={groupId}
                  templateId={template.id}
                  description={template.description}
                  paused={template.pausedAt !== null}
                  canEdit={canAdd}
                />
              </li>
            ))}
          </ul>
          {addButton}
        </>
      )}
    </div>
  );
}
