import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { restoreParticipant } from "@/modules/groups/service";
import { isUuid, mobileApiError, noStore } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Undo for a removal, same as the web's toast offers. The invitation link is
 * the one thing it cannot bring back — the server only ever held a hash of
 * the token — so a guest needs a fresh link afterwards.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]/restore">,
) {
  return trackRoute(
    "/api/groups/[groupId]/participants/[participantId]/restore",
    "POST",
    () => handlePost(context),
  );
}

async function handlePost(
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]/restore">,
) {
  const { groupId, participantId } = await context.params;
  if (!isUuid(groupId) || !isUuid(participantId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    await restoreParticipant(access, participantId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(
      error,
      "/api/groups/[groupId]/participants/[participantId]/restore POST",
      { groupId, participantId },
    );
  }
}
