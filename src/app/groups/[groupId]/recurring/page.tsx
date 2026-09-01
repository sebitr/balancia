import { getLocale, getTranslations } from "next-intl/server";
import { getDateFormatter } from "@/i18n/preferences";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Amount } from "@/components/money/amount";
import { RecurringForm } from "@/components/recurring/recurring-form";
import { RecurringRowActions } from "@/components/recurring/recurring-row-actions";
import { PageHeader } from "@/components/ui/page-header";
import { requireGroupAccess } from "@/lib/actions";
import { listRecurringExpenses } from "@/modules/recurring/service";
import type {
  RecurrenceFrequency,
  WeekOfMonth,
} from "@/modules/recurring/schedule";
import { listParticipants } from "@/modules/groups/service";
import { loadGroupBalances } from "@/modules/balances/service";
import { defaultCurrency } from "@/modules/currencies/default-currency";
import { getUserPreferredCurrency } from "@/modules/auth/service";

/**
 * The locale's own name for an ISO weekday (1 = Monday). Taken from `Intl`
 * rather than the catalogue — see `recurring-form.tsx` for the same approach.
 * 2024-01-01 was a Monday, which lines the offsets up with ISO numbering.
 */
function weekdayName(locale: string, isoWeekday: number): string {
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, 0, isoWeekday)));
}

export default async function RecurringPage({
  params,
}: PageProps<"/groups/[groupId]/recurring">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [templates, participants, balances, preferredCurrency] =
    await Promise.all([
      listRecurringExpenses(access.groupId),
      listParticipants(access.groupId),
      // For the currency the form opens on, and nothing else: a repeating
      // expense should default to what the group already spends in, on the
      // same reasoning as the entry drawer. See `default-currency`.
      loadGroupBalances(access),
      access.actor.kind === "user"
        ? getUserPreferredCurrency(access.actor.userId)
        : null,
    ]);

  const t = await getTranslations("recurringPage");
  const tCommon = await getTranslations("common");
  const dates = await getDateFormatter();
  const locale = await getLocale();

  const describeSchedule = (template: {
    frequency: RecurrenceFrequency;
    interval: number;
    weekday: number | null;
    weekOfMonth: WeekOfMonth | null;
    dayOfMonth: number | null;
    monthOfYear: number | null;
  }): string => {
    switch (template.frequency) {
      case "daily":
        return t("daily", { count: template.interval });
      case "weekly":
        return t("weekly", {
          count: template.interval,
          day: weekdayName(locale, template.weekday ?? 1),
        });
      case "monthly":
        // "Every 2 months on the second Tuesday" and "every 2 months on the
        // 3rd" are two sentences, because the second half is a different kind
        // of thing in each.
        if (template.weekOfMonth != null) {
          return t("monthlyWeekday", {
            count: template.interval,
            week: t(`week.${template.weekOfMonth}`),
            day: weekdayName(locale, template.weekday ?? 1),
          });
        }
        return t("monthly", {
          count: template.interval,
          day: template.dayOfMonth ?? 1,
        });
      case "yearly":
        return t("yearly", {
          count: template.interval,
          day: template.dayOfMonth ?? 1,
          month: template.monthOfYear ?? 1,
        });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        {/* Reached from the shortcut at the foot of the group's settings, so
            that is the one step back. */}
        <PageHeader
          title={t("title")}
          back={{
            href: `/groups/${groupId}/settings`,
            label: tCommon("backToGroupSettings"),
          }}
        />
        <p className="pl-10.5 text-sm text-muted-foreground">
          {t("intro", { timezone: access.group.timezone })}
        </p>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
        />
      ) : (
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
                        date: dates.at(template.nextRunAt),
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
              />
            </li>
          ))}
        </ul>
      )}

      {access.permissions.manageRecurring && participants.length > 0 && (
        <RecurringForm
          groupId={access.groupId}
          participants={participants.map((participant) => ({
            id: participant.id,
            displayName: participant.displayName,
          }))}
          currencyMode={access.group.currencyMode}
          baseCurrency={access.group.baseCurrency}
          defaultCurrency={defaultCurrency({
            base: access.group.baseCurrency,
            used: balances.currencies.map((entry) => ({
              currency: entry.currency,
              weight: entry.totalOutstanding,
            })),
            preferred: preferredCurrency,
          })}
        />
      )}
    </div>
  );
}
