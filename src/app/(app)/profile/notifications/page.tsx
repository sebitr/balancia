import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getFormatter, getTranslations } from "next-intl/server";
import { BellRing, Smartphone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MutedGroupsForm } from "@/components/notifications/muted-groups-form";
import { NotificationPreferencesForm } from "@/components/notifications/notification-preferences-form";
import { PushToggle } from "@/components/notifications/push-toggle";
import { getCurrentUser } from "@/lib/security/actor";
import { listGroupsForUser } from "@/modules/groups/service";
import {
  getPreferences,
  listMutedGroups,
} from "@/modules/notifications/service";
import { listSubscriptions } from "@/modules/notifications/subscriptions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationSettings");
  return { title: t("metaTitle") };
}

export default async function NotificationSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const t = await getTranslations("notificationSettings");
  const format = await getFormatter();

  const [preferences, mutedGroupIds, groups, devices] = await Promise.all([
    getPreferences(user.userId),
    listMutedGroups(user.userId),
    listGroupsForUser(user.userId),
    listSubscriptions(user.userId),
  ]);

  const muted = new Set(mutedGroupIds);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("categoriesTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesForm defaultValue={preferences} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BellRing className="size-4" aria-hidden="true" />
            {t("pushTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("pushDescription")}
          </p>
          <PushToggle />

          {devices.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <h2 className="text-sm font-medium">{t("devicesTitle")}</h2>
              <ul className="space-y-1 text-xs text-muted-foreground">
                {devices.map((device) => (
                  <li key={device.id} className="flex items-center gap-2">
                    <Smartphone className="size-3.5" aria-hidden="true" />
                    <span>{device.userAgent ?? t("deviceUnknown")}</span>
                    <span className="text-muted-foreground/70">
                      {t("deviceAdded", {
                        date: format.dateTime(device.createdAt, {
                          dateStyle: "medium",
                        }),
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">{t("mutedTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("mutedHelp")}</p>
          <MutedGroupsForm
            groups={groups.map((group) => ({
              id: group.id,
              name: group.name,
              muted: muted.has(group.id),
            }))}
          />
        </CardContent>
      </Card>
    </div>
  );
}
