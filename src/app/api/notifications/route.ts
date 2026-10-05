import {
  countUnread,
  listNotifications,
} from "@/modules/notifications/service";
import {
  apiUser,
  mobileApiError,
  noStore,
  serializeNotification,
} from "@/app/api/mobile";
import { MAX_CALENDAR_YEAR, MIN_CALENDAR_YEAR } from "@/lib/calendar-date";
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
    const user = await apiUser(request, "/api/notifications", "GET");
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
    // A JavaScript date reaches back to 271821 BC and PostgreSQL's timestamps
    // stop at 4713 BC, so a `before` in between failed the query as a 500.
    // The bound is the calendar years Balancia accepts rather than
    // PostgreSQL's own, since every instant it stores sits inside them; a
    // client wanting the newest page leaves `before` out.
    if (
      before &&
      (Number.isNaN(before.getTime()) ||
        before.getUTCFullYear() < MIN_CALENDAR_YEAR ||
        before.getUTCFullYear() > MAX_CALENDAR_YEAR)
    ) {
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
