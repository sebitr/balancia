import { z } from "zod";
import { getEnv } from "@/lib/env";
import { getCurrentActor, getCurrentUser } from "@/lib/security/actor";
import {
  authorizeGroup,
  requirePermission,
  type GroupAccess,
} from "@/lib/security/authorization";
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
 * The group-wide join link: the group's front door.
 *
 * GET describes the newest one — its state, its age, and the URL itself where
 * the sealed copy still opens; POST mints a fresh one, revoking whatever the
 * group had; DELETE revokes it.
 *
 * All three are the owner's, through `manageInvitations`, which is the
 * permission gating the card they are called from on the web. This route used
 * to check only that the caller was in the group at all, on the strength of a
 * comment saying any member may share the group they are in — which the web
 * has never done: all three of its pages read this link behind that same
 * permission, so a member has never been shown one. What the route actually
 * offered was a guest — somebody holding a forwarded invitation — the ability
 * to mint a standing way into the group, and to revoke the owner\'s.
 *
 * The URL is new here, and it is the reason the permission could not stay
 * loose. The web has shown it since the token gained a sealed copy
 * (`describeJoinLink`), and this route kept answering with the prefix alone,
 * so the phone could name a link it could not hand over.
 */
async function requireLinkAdmin(
  groupId: string,
  requireActive = false,
): Promise<GroupAccess> {
  const actor = await getCurrentActor();
  const access = await authorizeGroup(actor, groupId, { requireActive });
  requirePermission(access, "manageInvitations");
  return access;
}

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
    const access = await requireLinkAdmin(groupId);
    const link = await describeJoinLink(access.groupId);
    return noStore({
      link: link
        ? {
            status: link.status,
            // Null for a link minted before the sealed copy existed, or under
            // a since-rotated `AUTH_SECRET`. It still works for everybody
            // holding it; it just cannot be shown again, which is why the
            // prefix stays beside it rather than being replaced by it.
            url: link.url,
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
    const access = await requireLinkAdmin(groupId, true);
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
    const access = await requireLinkAdmin(groupId);
    await revokeJoinLink(access.groupId);
    return noStore({ ok: true });
  } catch (error) {
    return mobileApiError(error, "/api/groups/[groupId]/join-link DELETE", {
      groupId,
    });
  }
}
