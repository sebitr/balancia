import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { listGroupActivity } from "@/modules/activity/service";
import {
  isUuid,
  mobileApiError,
  noStore,
  serializeActivity,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/** The group's append-only history, newest first. */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/activity">,
) {
  return trackRoute("/api/groups/[groupId]/activity", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/activity">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  const url = new URL(request.url);
  const limitRaw = Number(url.searchParams.get("limit") ?? "100");
  const limit =
    Number.isInteger(limitRaw) && limitRaw >= 1 && limitRaw <= 200
      ? limitRaw
      : 100;

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const activity = await listGroupActivity(access.groupId, { limit });
    return noStore({ activity: activity.map(serializeActivity) });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/activity GET", {
      groupId,
    });
  }
}
