import type { ActivityEntry } from "@/modules/activity/service";

/**
 * Activity history rendering.
 *
 * Events are stored as an action plus safe metadata, so the wording lives here
 * rather than in the database — a phrasing change does not require rewriting
 * history.
 */

const ACTION_TEXT: Record<string, string> = {
  "expense.created": "added an expense",
  "expense.updated": "edited an expense",
  "expense.deleted": "deleted an expense",
  "settlement.created": "recorded a payment",
  "settlement.updated": "edited a payment",
  "settlement.deleted": "deleted a payment",
  "member.added": "added a member",
  "member.removed": "removed a member",
  "member.role_changed": "changed a member's role",
  "participant.created": "added someone to the group",
  "participant.updated": "updated someone's details",
  "participant.removed": "removed someone from the group",
  "guest_link.created": "created a guest link",
  "guest_link.revoked": "revoked a guest link",
  "guest_link.redeemed": "joined through a guest link",
  "recurring.created": "set up a recurring expense",
  "recurring.updated": "changed a recurring expense",
  "recurring.deleted": "removed a recurring expense",
  "recurring.generated": "generated a recurring expense",
  "import.completed": "completed an import",
  "group.created": "created the group",
  "group.updated": "updated the group",
  "group.archived": "archived the group",
};

function describe(entry: ActivityEntry): string {
  const base = ACTION_TEXT[entry.action] ?? entry.action;
  const description = entry.metadata?.description;
  if (typeof description === "string" && description.length > 0) {
    return `${base}: ${description}`;
  }
  return base;
}

function formatWhen(value: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

export function ActivityFeed({
  entries,
}: {
  entries: readonly ActivityEntry[];
}) {
  if (entries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
        Nothing has happened in this group yet.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3 text-sm">
          <span
            aria-hidden="true"
            className="mt-2 size-1.5 shrink-0 rounded-full bg-border"
          />
          <span className="min-w-0">
            <span className="block">
              <span className="font-medium">
                {entry.actorLabel ??
                  (entry.actorType === "system" ? "Balancia" : "Someone")}
              </span>{" "}
              <span className="text-muted-foreground">{describe(entry)}</span>
            </span>
            <time
              dateTime={entry.createdAt.toISOString()}
              className="text-xs text-muted-foreground"
            >
              {formatWhen(entry.createdAt)}
            </time>
          </span>
        </li>
      ))}
    </ol>
  );
}
