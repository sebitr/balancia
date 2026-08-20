import { getCurrentActor } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import { loadGroupOverview } from "@/modules/groups/overview";
import { updateGroupSchema } from "@/modules/groups/schemas";
import {
  deleteGroup,
  getGroupProfile,
  listParticipants,
  setGroupArchived,
  updateGroup,
} from "@/modules/groups/service";
import {
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
  serializeAccess,
  serializeGroupOverview,
  serializeParticipant,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * One group, as its screen opens: who the reader is in it, everyone's
 * balances and the simplified who-pays-whom, and the people to offer in
 * pickers. Expenses and settlements page separately under their own routes.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]">,
) {
  return trackRoute("/api/groups/[groupId]", "GET", () => handleGet(context));
}

async function handleGet(context: RouteContext<"/api/groups/[groupId]">) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);

    const [overview, participants, profile] = await Promise.all([
      loadGroupOverview(access),
      listParticipants(access.groupId),
      getGroupProfile(access.groupId),
    ]);

    return noStore({
      ...serializeAccess(access),
      profile,
      participants: participants.map(serializeParticipant),
      overview: serializeGroupOverview(overview),
    });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId] GET", { groupId });
  }
}

/**
 * Group settings, as one screen submits them: the editable details, and the
 * archived flag. Either half may come alone — a client toggling "archived"
 * has no business restating the name, and the settings form never flips the
 * archive switch. `updateGroup` reads absent and empty as different things,
 * exactly as the web form does.
 */
export async function PATCH(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]">,
) {
  return trackRoute("/api/groups/[groupId]", "PATCH", () =>
    handlePatch(request, context),
  );
}

async function handlePatch(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]">,
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
    const access = await authorizeGroup(actor, groupId);
    const raw = body as Record<string, unknown>;

    if (raw.name !== undefined || raw.timezone !== undefined) {
      const parsed = updateGroupSchema.safeParse({
        name: raw.name,
        description: raw.description ?? "",
        icon: raw.icon === undefined ? undefined : raw.icon,
        iconColor: raw.iconColor === undefined ? undefined : raw.iconColor,
        timezone: raw.timezone,
      });
      if (!parsed.success) {
        return invalidInput(parsed.error);
      }
      await updateGroup(access, parsed.data);
    }

    if (typeof raw.archived === "boolean") {
      await setGroupArchived(access, raw.archived);
    }

    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId] PATCH", { groupId });
  }
}

/** Hard delete, exactly like the web's danger zone. There is no undo. */
export async function DELETE(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]">,
) {
  return trackRoute("/api/groups/[groupId]", "DELETE", () =>
    handleDelete(context),
  );
}

async function handleDelete(context: RouteContext<"/api/groups/[groupId]">) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    await deleteGroup(access);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId] DELETE", { groupId });
  }
}
