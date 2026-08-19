import Link from "next/link";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import { countUnread } from "@/modules/notifications/service";
import { cn } from "@/lib/utils";
import { PUSH } from "@/components/motion/transitions";

/**
 * The unread indicator in the header.
 *
 * Server-rendered, so the count is correct on first paint rather than
 * appearing a moment later. `NotificationRefresh` re-renders it when a push
 * arrives while the tab is open.
 *
 * Guests never see it: they have no account for a notification to belong to.
 */
export async function NotificationBell() {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("notificationsPage");
  const unread = await countUnread(user.userId);

  return (
    <Link
      href="/notifications"
      transitionTypes={PUSH}
      aria-label={unread > 0 ? t("bellUnread", { count: unread }) : t("bell")}
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-md",
        "text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
      )}
    >
      <Bell className="size-5" aria-hidden="true" />
      {unread > 0 && (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-1 right-1 flex min-w-4 items-center justify-center",
            "rounded-full bg-primary px-1 text-2xs leading-4 font-medium text-primary-foreground",
          )}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
