import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { PageHeader } from "@/components/ui/page-header";
import { requireGroupAccess } from "@/lib/actions";
import { listGroupActivity } from "@/modules/activity/service";

/**
 * The group's full history.
 *
 * The overview shows the last four events and hands the rest here, so "what
 * changed while I was away" stays a glance rather than a scroll.
 */

/** Deep enough to cover a long trip, short enough to stay one request. */
const LIMIT = 100;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("group");
  return { title: t("activityMetaTitle") };
}

export default async function GroupActivityPage({
  params,
}: PageProps<"/groups/[groupId]/activity">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);
  const [entries, t, tCommon] = await Promise.all([
    listGroupActivity(access.groupId, { limit: LIMIT }),
    getTranslations("group"),
    getTranslations("common"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("activityTitle")}
        back={{ href: `/groups/${groupId}`, label: tCommon("backToGroup") }}
      />
      <ActivityFeed entries={entries} />
    </div>
  );
}
