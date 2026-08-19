import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getCurrentActor, getCurrentUser } from "@/lib/security/actor";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  createJoinLink,
  describeJoinLink,
  revokeJoinLink,
} from "@/lib/security/join-link";
import {
  invalidInput,
  isUuid,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The group-wide join link. GET describes the live one (prefix and age — the
 * token itself is only a hash by now), POST mints a fresh one and returns the
 * full URL once, DELETE revokes it. Any member may share the group they are
 * in, same as the web.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/join-link">,
) {
  return trackRoute("/api/groups/[groupId]/join-link", "GET", () =>
    handleGet(context),
  );
}

async function handleGet(
  context: RouteContext<"/api/groups/[groupId]/join-link">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    const link = await describeJoinLink(access.groupId);
    return noStore({
      link: link
        ? {
            prefix: link.prefix,
            createdAt: link.createdAt.toISOString(),
            expiresAt: link.expiresAt?.toISOString() ?? null,
            lastUsedAt: link.lastUsedAt?.toISOString() ?? null,
          }
        : null,
    });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/join-link GET", {
      groupId,
    });
  }
}

const createLinkSchema = z.object({
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

export async function POST(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/join-link">,
) {
  return trackRoute("/api/groups/[groupId]/join-link", "POST", () =>
    handlePost(request, context),
  );
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/join-link">,
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

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId, {
      requireActive: true,
    });
    const parsed = createLinkSchema.safeParse({
      expiresInDays: raw.expiresInDays ?? undefined,
    });
    if (!parsed.success) {
      return invalidInput(parsed.error);
    }

    const user = await getCurrentUser();
    const expiresAt = parsed.data.expiresInDays
      ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
      : null;
    const link = await createJoinLink(access.groupId, {
      createdByUserId: user?.userId ?? null,
      expiresAt,
    });

    return noStore(
      {
        url: `${getEnv().appOrigin}/join/g/${link.token}`,
        expiresAt: expiresAt?.toISOString() ?? null,
      },
      { status: 201 },
    );
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/join-link POST", {
      groupId,
    });
  }
}

export async function DELETE(
  request: Request,
  context: RouteContext<"/api/groups/[groupId]/join-link">,
) {
  return trackRoute("/api/groups/[groupId]/join-link", "DELETE", () =>
    handleDelete(context),
  );
}

async function handleDelete(
  context: RouteContext<"/api/groups/[groupId]/join-link">,
) {
  const { groupId } = await context.params;
  if (!isUuid(groupId)) {
    return noStore({ error: "Not found." }, { status: 404 });
  }

  try {
    const actor = await getCurrentActor();
    const access = await authorizeGroup(actor, groupId);
    await revokeJoinLink(access.groupId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/join-link DELETE", {
      groupId,
    });
  }
}
