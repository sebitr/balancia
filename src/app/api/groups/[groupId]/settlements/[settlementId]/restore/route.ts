import { authorizeGroup } from "@/lib/security/authorization";
import { restoreSettlement } from "@/modules/settlements/service";
import { apiActor, isUuid, mobileApiError, noStore } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/** Undo for a deletion, same as the web's toast offers. */

const ROUTE = "/api/groups/[groupId]/settlements/[settlementId]/restore";
type Context =
  RouteContext<"/api/groups/[groupId]/settlements/[settlementId]/restore">;

export async function POST(request: Request, context: Context) {
  return trackRoute(ROUTE, "POST", () => handlePost(request, context));
}

async function handlePost(request: Request, context: Context) {
  const { groupId, settlementId } = await context.params;
  if (!isUuid(groupId) || !isUuid(settlementId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await apiActor(
      request,
      "/api/groups/[groupId]/settlements/[settlementId]/restore",
      "POST",
    );
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await restoreSettlement(access, settlementId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} POST`, { groupId, settlementId });
  }
}
