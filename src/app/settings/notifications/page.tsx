import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getDateFormatter } from "@/i18n/preferences";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { SettingsCard } from "@/components/settings/settings-card";
import { PushCard } from "@/components/settings/push-card";
import { MutedGroupsForm } from "@/components/notifications/muted-groups-form";
import { NotificationPreferencesForm } from "@/components/notifications/notification-preferences-form";
import { getCurrentUser } from "@/lib/security/actor";
import { listGroupsForUser } from "@/modules/groups/service";
import {
  getPreferences,
  listMutedGroups,
} from "@/modules/notifications/service";
import { listSubscriptions } from "@/modules/notifications/subscriptions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("notifications") };
}

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("userSettings");
  const tNotify = await getTranslations("notificationSettings");
  const dates = await getDateFormatter();

  const [preferences, mutedGroupIds, groups, devices] = await Promise.all([
    getPreferences(user.userId),
    listMutedGroups(user.userId),
    listGroupsForUser(user.userId),
    listSubscriptions(user.userId),
  ]);

  const muted = new Set(mutedGroupIds);

  return (
    <SettingsScreen
      title={t("notifications")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <SettingsCard title={tNotify("categoriesTitle")}>
        <NotificationPreferencesForm defaultValue={preferences} />
      </SettingsCard>

      <PushCard
        devices={devices.map((device) => ({
          id: device.id,
          label: device.userAgent ?? tNotify("deviceUnknown"),
          added: tNotify("deviceAdded", { date: dates.at(device.createdAt) }),
        }))}
      />

      <SettingsCard
        title={tNotify("mutedTitle")}
        description={tNotify("mutedHelp")}
      >
        <MutedGroupsForm
          groups={groups.map((group) => ({
            id: group.id,
            name: group.name,
            muted: muted.has(group.id),
          }))}
        />
      </SettingsCard>
    </SettingsScreen>
  );
}
