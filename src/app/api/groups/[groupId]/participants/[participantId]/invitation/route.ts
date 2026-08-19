import { getEnv } from "@/lib/env";
import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { createInvitationSchema } from "@/modules/groups/schemas";
import { createInvitation, revokeInvitation } from "@/modules/groups/service";
import {
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * One person's invitation link. POST mints it and returns the full URL — the
 * only time it exists in the clear, exactly as on the web — and DELETE
 * revokes it. The server keeps a hash, so there is no GET.
 */
export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]/invitation">,
) {
  return trackRoute(
    "/api/groups/[groupId]/participants/[participantId]/invitation",
    "POST",
    () => handlePost(request, context),
  );
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]/invitation">,
) {
  const { groupId, participantId } = await context.params;
  if (!isUuid(groupId) || !isUuid(participantId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }
  const body = await readJsonBody(request);
  const raw =
    body !== undefined && typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    const parsed = createInvitationSchema.safeParse({
      participantId,
      expiresInDays: raw.expiresInDays ?? undefined,
    });
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    const invitation = await createInvitation(access, parsed.data);
    return noStore(
      {
        url: `${getEnv().appOrigin}/join/${invitation.token}`,
        expiresAt: invitation.expiresAt?.toISOString() ?? null,
      },
      { status: 201 },
    );
  } catch (error) {
    return mobileApiError(
      error,
      "/api/groups/[groupId]/participants/[participantId]/invitation POST",
      { groupId, participantId },
    );
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]/invitation">,
) {
  return trackRoute(
    "/api/groups/[groupId]/participants/[participantId]/invitation",
    "DELETE",
    () => handleDelete(context),
  );
}

async function handleDelete(
  context: RouteContext<"/api/groups/[groupId]/participants/[participantId]/invitation">,
) {
  const { groupId, participantId } = await context.params;
  if (!isUuid(groupId) || !isUuid(participantId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    await revokeInvitation(access, participantId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(
      error,
      "/api/groups/[groupId]/participants/[participantId]/invitation DELETE",
      { groupId, participantId },
    );
  }
}
