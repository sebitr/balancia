import { getCurrentActor, getCurrentUser } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { setGroupMuted } from "@/modules/notifications/service";
import {
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Silences or unsilences this group's notifications for the reader. A
 * per-user setting about a group, so it needs both an account and membership.
 */
export async function PUT(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/mute">,
) {
  return trackRoute("/api/groups/[groupId]/mute", "PUT", () =>
    handlePut(request, context),
  );
}

async function handlePut(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/mute">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const body = await readJsonBody(request);
  const raw =
    body !== undefined && typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  if (typeof raw.muted !== "boolean") {
    return noStore({ error: "Send { muted: boolean }." }, { status: 400 });
  }

  try {
    const user = await getCurrentUser();
    if (!user) {
      return noStore(
        { error: "Sign in with an account to mute a group." },
        { status: 403 },
      );
    }
    const access = await authorizeGroup(await getCurrentActor(), groupId);
    await setGroupMuted(user.userId, access.groupId, raw.muted);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/mute PUT", {
      groupId,
    });
  }
}
