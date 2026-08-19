import { getCurrentUser } from "@/lib/security/actor";
import {
  countUnread,
  listNotifications,
} from "@/modules/notifications/service";
import {
  mobileApiError,
  noStore,
  serializeNotification,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The inbox, newest first, with the unread count the badge shows. Guests have
 * no account and therefore no inbox.
 */
export async function GET(request: Request) {
  return trackRoute("/api/notifications", "GET", () => handleGet(request));
}

async function handleGet(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }

    const url = new URL(request.url);
    const limitRaw = Number(url.searchParams.get("limit") ?? "50");
    const limit =
      Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 100
        ? limitRaw
        : 50;
    const beforeRaw = url.searchParams.get("before");
    const before = beforeRaw ? new Date(beforeRaw) : undefined;
    if (before && Number.isNaN(before.getTime())) {
      return noStore({ error: "Invalid `before` instant." }, { status: 400 });
    }

    const [notifications, unread] = await Promise.all([
      listNotifications(user.userId, { limit, before }),
      countUnread(user.userId),
    ]);
    return noStore({
      notifications: notifications.map(serializeNotification),
      unread,
    });
  } catch (error) {
    return mobileApiError(error, "/api/notifications GET");
  }
}
