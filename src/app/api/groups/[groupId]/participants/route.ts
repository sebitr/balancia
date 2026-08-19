import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { addParticipantSchema } from "@/modules/groups/schemas";
import { addParticipant, listParticipants } from "@/modules/groups/service";
import {
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
  serializeParticipant,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The People screen's list and its "add someone" gesture. The group detail
 * route already inlines participants; this one exists so the screen can
 * refresh them alone after a rename or an invitation without re-deriving
 * every balance.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants">,
) {
  return trackRoute("/api/groups/[groupId]/participants", "GET", () =>
    handleGet(context),
  );
}

async function handleGet(
  context: RouteContext<"/api/groups/[groupId]/participants">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const participants = await listParticipants(access.groupId);
    return noStore({ participants: participants.map(serializeParticipant) });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/participants GET", {
      groupId,
    });
  }
}

export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants">,
) {
  return trackRoute("/api/groups/[groupId]/participants", "POST", () =>
    handlePost(request, context),
  );
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
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

    const participantId = await addParticipant(access, parsed.data);
    return noStore({ participantId }, { status: 201 });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/participants POST", {
      groupId,
    });
  }
}
