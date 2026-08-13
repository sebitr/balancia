import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Amount } from "@/components/money/amount";
import { RecurringForm } from "@/components/recurring/recurring-form";
import { RecurringRowActions } from "@/components/recurring/recurring-row-actions";
import { requireGroupAccess } from "@/lib/actions";
import { listRecurringExpenses } from "@/modules/recurring/service";
import { listParticipants } from "@/modules/groups/service";

const WEEKDAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function describeSchedule(template: {
  frequency: "weekly" | "monthly" | "yearly";
  interval: number;
  weekday: number | null;
  dayOfMonth: number | null;
  monthOfYear: number | null;
}): string {
  const every =
    template.interval === 1 ? "Every" : `Every ${template.interval}`;
  switch (template.frequency) {
    case "weekly":
      return `${every} ${template.interval === 1 ? "week" : "weeks"} on ${
        WEEKDAYS[(template.weekday ?? 1) - 1]
      }`;
    case "monthly":
      return `${every} ${template.interval === 1 ? "month" : "months"} on day ${template.dayOfMonth}`;
    case "yearly":
      return `${every} ${template.interval === 1 ? "year" : "years"} on ${template.dayOfMonth}/${template.monthOfYear}`;
  }
}

export default async function RecurringPage({
  params,
}: PageProps<"/groups/[groupId]/recurring">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [templates, participants] = await Promise.all([
    listRecurringExpenses(access.groupId),
    listParticipants(access.groupId),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Recurring expenses
        </h1>
        <p className="text-sm text-muted-foreground">
          Generated automatically in the group&apos;s timezone (
          {access.group.timezone}).
        </p>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={RefreshCw}
          title="No recurring expenses"
          description="Set one up for rent, a subscription or any bill that arrives on a schedule."
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
                    <Badge variant="secondary">Paused</Badge>
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
                    ? `Next: ${new Date(template.nextRunAt).toLocaleDateString()}`
                    : template.pausedAt
                      ? "Paused — nothing will be generated"
                      : "No further occurrences"}
                  {template.generatedCount > 0 &&
                    ` · ${template.generatedCount} generated so far`}
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
          defaultCurrency={access.group.baseCurrency ?? "EUR"}
        />
      )}
    </div>
  );
}
