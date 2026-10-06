import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { PageHeader } from "@/components/ui/page-header";
import { requireGroupAccess } from "@/lib/actions";
import {
  findRestorableDeletions,
  listGroupActivity,
} from "@/modules/activity/service";

/**
 * The group's full history.
 *
 * The overview shows only what is new and hands the rest here, so "what
 * changed while I was away" stays a glance rather than a scroll. It leads here
 * from that block's "View all" and from a row at its foot that is there
 * whether or not anything is new; so does the Shortcuts card in settings.
 *
 * It is also where a deleted entry, or a removed person, comes back from once
 * the Undo toast has gone. The overview's short list offers no such button: it
 * is a summary of news, and this is the page that answers "where did it go".
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
  // After the list rather than beside it: which deletions can still be taken
  // back is a question about exactly these rows.
  const restorable = await findRestorableDeletions(access, entries);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("activityTitle")}
        back={{ href: `/groups/${groupId}`, label: tCommon("backToGroup") }}
      />
      <ActivityFeed
        entries={entries}
        groupId={access.groupId}
        restorable={restorable}
        timeZone={access.group.timezone}
        viewerId={access.participantId}
      />
    </div>
  );
}
