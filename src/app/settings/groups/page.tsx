import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight } from "lucide-react";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { initialOf } from "@/components/entries/initials";
import { getCurrentUser } from "@/lib/security/actor";
import { listGroupsForUser } from "@/modules/groups/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("groups") };
}

/**
 * Every group, and the way into each one's own settings.
 *
 * A directory, not an editor. Nothing about a group is changed here: what a
 * group is called, who is in it and what currency it keeps belong to the
 * group, are decided by the people in that group, and already have a screen.
 * This exists because "settings" is where somebody looks for them, and being
 * sent to the right place beats a second set of controls that has to agree
 * with the first.
 */
export default async function GroupsSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("userSettings");
  const groups = await listGroupsForUser(user.userId);

  return (
    <SettingsScreen
      title={t("groups")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      {groups.length === 0 ? (
        <p className="shrink-0 px-1.5 text-xs text-muted-foreground">
          {t("noGroups")}
        </p>
      ) : (
        <div className="shrink-0 overflow-hidden rounded-xl bg-card text-card-foreground ring-1 ring-foreground/10">
          {groups.map((group) => (
            <Link
              key={group.id}
              href={`/groups/${group.id}/settings`}
              className="flex min-h-11 items-center gap-3 px-4 py-3 transition-colors not-first:border-t not-first:border-border hover:bg-foreground/4 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:-outline-offset-2 focus-visible:outline-none"
            >
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-secondary text-2xs font-semibold text-secondary-foreground"
              >
                {initialOf(group.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {group.name}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {t("groupPeople", { count: group.participantCount })}
                  {group.role === "owner" && ` · ${t("groupYouAreAdmin")}`}
                  {group.archivedAt && ` · ${t("groupArchived")}`}
                </span>
              </span>
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </Link>
          ))}
        </div>
      )}
    </SettingsScreen>
  );
}
