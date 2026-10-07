import type { Metadata } from "next";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  ChevronRight,
  History,
  Repeat2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyModeNote } from "@/components/groups/currency-mode-note";
import { DangerZone } from "@/components/groups/danger-zone";
import { ExportCard } from "@/components/groups/export-card";
import { GroupSettingsForm } from "@/components/groups/group-settings-form";
import { InviteLinkCard } from "@/components/groups/invite-link-card";
import { requireGroupAccess } from "@/lib/actions";
import { PUSH } from "@/components/motion/transitions";
import { describeJoinLink } from "@/lib/security/join-link";
import {
  countUnclaimedParticipants,
  getGroupProfile,
} from "@/modules/groups/service";
import { isGroupIcon, isGroupIconColor } from "@/modules/groups/icons";

/**
 * The group's own settings.
 *
 * Ordered by how often it is opened for each: what the group is called, then
 * the link that lets everybody else in, then getting the data out, then the
 * screens this one is the way to, then the two ways to end it. The invite
 * link sits that high because it is the one control here that reaches past the
 * group — the rest says what the group is, that one says who else is in it.
 * Every card writes as it is used; none of them has a Save. The currency mode
 * used to be a card here; it cannot be changed, so it is a line at the foot of
 * Details instead.
 *
 * From `lg` up the same cards in the same order stand in two columns: what
 * the group is and who else can be in it on the left — Details, then the
 * link — and what this screen is the way out to on the right — the export,
 * the shortcuts, and the two ways to end the group last of all, apart at the
 * foot. Read down the left and then the right, that is exactly the order
 * above, which is the order a phone and a screen reader keep at every width.
 * The board drew the link at the top of the right-hand column; it moved
 * across because Details is one card here where the board drew three, and
 * the right would otherwise have run twice the length of the left.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settingsPage");
  return { title: t("title") };
}

export default async function GroupSettingsPage({
  params,
}: PageProps<"/groups/[groupId]/settings">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);
  const t = await getTranslations("settingsPage");
  const tGroup = await getTranslations("groupSettings");

  const manage = access.permissions.manageGroupSettings;
  const invites = access.permissions.manageInvitations;
  // Each of these is read for one card, so a reader who cannot see that card
  // pays for none of it.
  const [profile, joinLink, unclaimedCount] = await Promise.all([
    manage ? getGroupProfile(access.groupId) : null,
    invites ? describeJoinLink(access.groupId) : null,
    invites ? countUnclaimedParticipants(access.groupId) : 0,
  ]);
  // One instant for the whole render, so the card's "in 6 days" is a
  // subtraction the browser can repeat and get the same answer.
  const now = new Date().toISOString();

  return (
    // `data-layout="wide"` asks the screen for the room two columns need from
    // `lg` up; below it the screen does not read it. The columns are halves at
    // `lg`, where a 1024px window beside the sidebar leaves each about 360px,
    // and seven to five from `xl`, as the overview's are. Each column is a
    // stack of its own, so a tall card on one side never opens a gap on the
    // other; on a phone the two stacks are simply one after the other, at the
    // same 20px.
    <div
      data-layout="wide"
      className="flex flex-col gap-5 lg:grid lg:grid-cols-2 lg:items-start lg:gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
    >
      <h1 className="font-heading text-2xl font-semibold tracking-tight lg:col-span-2">
        {t("title")}
      </h1>

      <div data-slot="settings-column" className="flex min-w-0 flex-col gap-5">
        {profile ? (
          <GroupSettingsForm
            groupId={access.groupId}
            name={profile.name}
            description={profile.description}
            icon={isGroupIcon(profile.icon) ? profile.icon : null}
            color={
              isGroupIconColor(profile.iconColor) ? profile.iconColor : null
            }
            timezone={access.group.timezone}
            currencyMode={access.group.currencyMode}
            baseCurrency={access.group.baseCurrency}
          />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>{tGroup("details")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("ownerOnly")}</p>
              <div className="border-t pt-4">
                <CurrencyModeNote
                  currencyMode={access.group.currencyMode}
                  baseCurrency={access.group.baseCurrency}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {invites && (
          <InviteLinkCard
            groupId={access.groupId}
            groupName={access.group.name}
            link={
              joinLink
                ? {
                    status: joinLink.status,
                    url: joinLink.url,
                    expiresAt: joinLink.expiresAt?.toISOString() ?? null,
                  }
                : null
            }
            unclaimedCount={unclaimedCount}
            now={now}
          />
        )}
      </div>

      <div data-slot="settings-column" className="flex min-w-0 flex-col gap-5">
        {access.permissions.exportData && (
          <ExportCard
            groupId={access.groupId}
            canImport={access.permissions.importData}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t("shortcuts")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border overflow-hidden rounded-lg border">
              {/* Says where it came from, so the screen's back arrow returns
                  here: the transactions list is the other way in. */}
              <ShortcutRow
                href={`/groups/${groupId}/recurring?from=settings`}
                icon={Repeat2}
                label={t("recurring")}
              />
              {/* For everyone who can open this screen, as the overview's row
                  is: Activity asks for no more access than settings does. */}
              <ShortcutRow
                href={`/groups/${groupId}/activity`}
                icon={History}
                label={t("activity")}
              />
              {access.permissions.importData && (
                <ShortcutRow
                  href={`/groups/${groupId}/import`}
                  icon={Upload}
                  label={t("import")}
                />
              )}
            </ul>
          </CardContent>
        </Card>

        {/* A step more room above it from `lg` up, where it sits at the foot
            of a short column rather than a phone's long scroll: the two
            ways to end the group stand apart, as the board draws them, and
            do not read as one more card of shortcuts. */}
        {manage && (
          <div className="lg:pt-4">
            <DangerZone
              groupId={access.groupId}
              groupName={access.group.name}
              archived={access.group.archivedAt !== null}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** A screen this one is the way to, not a setting. */
function ShortcutRow({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <li>
      <Link
        href={href}
        transitionTypes={PUSH}
        className="flex items-center gap-2.5 px-3 py-3 transition-colors duration-150 hover:bg-muted/60"
      >
        <Icon
          aria-hidden="true"
          className="size-4.5 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {label}
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-[15px] shrink-0 text-muted-foreground"
        />
      </Link>
    </li>
  );
}
