import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronRight, Repeat2, Upload, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CurrencyModeNote } from "@/components/groups/currency-mode-note";
import { DangerZone } from "@/components/groups/danger-zone";
import { ExportCard } from "@/components/groups/export-card";
import { GroupSettingsForm } from "@/components/groups/group-settings-form";
import { requireGroupAccess } from "@/lib/actions";
import { PUSH } from "@/components/motion/transitions";
import { getGroupProfile } from "@/modules/groups/service";
import { isGroupIcon, isGroupIconColor } from "@/modules/groups/icons";

/**
 * The group's own settings.
 *
 * Ordered by how often it is opened for each: what the group is called, then
 * getting the data out, then the two screens this one is the way to, then the
 * two ways to end it. The currency mode used to be a card here; it cannot be
 * changed, so it is a line at the foot of Details instead.
 */
export default async function GroupSettingsPage({
  params,
}: PageProps<"/groups/[groupId]/settings">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);
  const t = await getTranslations("settingsPage");
  const tGroup = await getTranslations("groupSettings");

  const manage = access.permissions.manageGroupSettings;
  // The icon and description are read for the form alone, so only the person
  // who can edit them pays for the query.
  const profile = manage ? await getGroupProfile(access.groupId) : null;

  return (
    // The last card clears the save bar, which is only there when the form is
    // dirty but must never be the thing that hides Delete.
    <div className="space-y-5 pb-12">
      <h1 className="font-heading text-2xl font-semibold tracking-tight">
        {t("title")}
      </h1>

      {profile ? (
        <GroupSettingsForm
          groupId={access.groupId}
          name={profile.name}
          description={profile.description}
          icon={isGroupIcon(profile.icon) ? profile.icon : null}
          color={isGroupIconColor(profile.iconColor) ? profile.iconColor : null}
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
            <ShortcutRow
              href={`/groups/${groupId}/recurring`}
              icon={Repeat2}
              label={t("recurring")}
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

      {manage && (
        <DangerZone
          groupId={access.groupId}
          groupName={access.group.name}
          archived={access.group.archivedAt !== null}
        />
      )}
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
