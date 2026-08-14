import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Bell, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { NotificationList } from "@/components/notifications/notification-list";
import { getCurrentUser } from "@/lib/security/actor";
import { listNotifications } from "@/modules/notifications/service";
import {
  renderNotification,
  type Translate,
} from "@/modules/notifications/render";
import { PUSH } from "@/components/motion/transitions";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationsPage");
  return { title: t("metaTitle") };
}

/**
 * The inbox.
 *
 * Rendered on the server through the same renderer the push messages use, so
 * the card on a lock screen and the row in this list can never word the same
 * event differently.
 */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");

  const t = await getTranslations("notificationsPage");
  const translate = (await getTranslations("notifications")) as Translate;
  const locale = await getLocale();

  const entries = await listNotifications(user.userId, { limit: 50 });
  const items = entries.map((entry) => {
    const rendered = renderNotification(entry, translate, locale);
    return {
      id: entry.id,
      title: rendered.title,
      body: rendered.body,
      url: rendered.url,
      createdAt: entry.createdAt.toISOString(),
      read: entry.readAt !== null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          {t("title")}
        </h1>
        <Button asChild variant="outline" size="sm">
          <Link href="/profile/notifications" transitionTypes={PUSH}>
            <Settings2 aria-hidden="true" />
            {t("settingsLink")}
          </Link>
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={t("empty")}
          description={t("emptyHint")}
        />
      ) : (
        <NotificationList items={items} />
      )}
    </div>
  );
}
