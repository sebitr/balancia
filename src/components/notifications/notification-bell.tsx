import { cache } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import { countUnread } from "@/modules/notifications/service";
import { cn } from "@/lib/utils";
import { PUSH } from "@/components/motion/transitions";
import { SidebarLink } from "@/components/layout/app-sidebar";
import { AppBadge } from "./app-badge";

/**
 * The bell and the sidebar's row both draw the same count in one render; it
 * is read once.
 */
const unreadFor = cache((userId: string) => countUnread(userId));

/**
 * The unread indicator: the bell in the phone's header, and the Notifications
 * row in the desktop sidebar.
 *
 * Server-rendered, so the count is correct on first paint rather than
 * appearing a moment later. `NotificationRefresh` re-renders it when a push
 * arrives while the tab is open.
 *
 * The installed app's icon is badged from here too, off the same count and in
 * the same render — see `AppBadge`. That is what keeps the two honest: the
 * number on the home screen cannot drift from the one in the header, because
 * neither is fetched separately. Only the bell writes it: both are in the
 * document at every width, one of them hidden, and `AppBadge` wants exactly
 * one writer.
 *
 * Guests never see it: they have no account for a notification to belong to.
 */
export async function NotificationBell({
  variant = "header",
}: {
  /** `sidebar` is a row of the desktop sidebar's places, beside Home. */
  variant?: "header" | "sidebar";
}) {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("notificationsPage");
  const unread = await unreadFor(user.userId);

  if (variant === "sidebar") {
    return (
      <SidebarLink
        href="/notifications"
        icon={<Bell aria-hidden="true" className="size-[18px] shrink-0" />}
        label={t("bell")}
        // The count is drawn as a pill, which says nothing to a screen
        // reader; the name says it instead, starting with the visible label.
        accessibleName={
          unread > 0 ? t("bellUnread", { count: unread }) : undefined
        }
        count={unread}
        transitionTypes={PUSH}
      />
    );
  }

  return (
    <>
      <AppBadge count={unread} />
      <Link
        href="/notifications"
        transitionTypes={PUSH}
        aria-label={unread > 0 ? t("bellUnread", { count: unread }) : t("bell")}
        className={cn(
          "tap-target relative inline-flex size-9 items-center justify-center rounded-md",
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
    </>
  );
}
