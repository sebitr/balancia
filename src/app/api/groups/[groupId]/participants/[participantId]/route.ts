import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { addParticipantSchema } from "@/modules/groups/schemas";
import { removeParticipant, updateParticipant } from "@/modules/groups/service";
import {
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * One person's row on the People screen: rename them (or set the email an
 * invitation would greet them by), or remove them. Removal is the soft,
 * revocable kind — `restore/` under this path is its undo.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]">,
) {
  return trackRoute(
    "/api/groups/[groupId]/participants/[participantId]",
    "PATCH",
    () => handlePatch(request, context),
  );
}

async function handlePatch(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]">,
) {
  const { groupId, participantId } = await context.params;
  if (!isUuid(groupId) || !isUuid(participantId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const body = await readJsonBody(request);
  if (body === undefined || typeof body !== "object" || body === null) {
    return noStore({ error: "Send a JSON body." }, { status: 400 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    const raw = body as Record<string, unknown>;
    const parsed = addParticipantSchema.safeParse({
      displayName: raw.displayName,
      email: raw.email ?? "",
    });
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    await updateParticipant(access, participantId, parsed.data);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(
      error,
      "/api/groups/[groupId]/participants/[participantId] PATCH",
      { groupId, participantId },
    );
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]">,
) {
  return trackRoute(
    "/api/groups/[groupId]/participants/[participantId]",
    "DELETE",
    () => handleDelete(context),
  );
}

async function handleDelete(
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]">,
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
    await removeParticipant(access, participantId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(
      error,
      "/api/groups/[groupId]/participants/[participantId] DELETE",
      { groupId, participantId },
    );
  }
}
