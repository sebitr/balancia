"use server";

import { revalidatePath } from "next/cache";
import {
  actionError,
  actionOk,
  requireGroupAccess,
  runAction,
  type ActionResult,
} from "@/lib/actions";
import { getCurrentUser } from "@/lib/security/actor";
import {
  createJoinLink,
  joinLinkUrl,
  revokeJoinLink,
  setJoinLinkExpiry,
} from "@/lib/security/join-link";
import { requirePermission } from "@/lib/security/authorization";
import { clearJoinCookie } from "@/modules/auth/cookies";
import {
  DEFAULT_JOIN_LINK_EXPIRY,
  expiryDate,
  isExpiryChoice,
  type JoinLinkExpiryChoice,
} from "./expiry";

/**
 * The join link's own mutations: minting it, moving its expiry, revoking it.
 *
 * Finishing a join is no longer here. It creates an account and puts that
 * account in a group, and the credential half of that now happens in three
 * different places — a Server Action for a code, a route handler for a
 * passkey, a second request for either — so the group half moved to
 * `signup-join.ts`, which all three end in.
 */

/** Ends the flow without joining, so a shared phone leaves nothing behind. */
export async function abandonJoinAction(): Promise<void> {
  await clearJoinCookie();
}

export interface JoinLinkResult {
  readonly url: string;
  readonly expiresAt: string | null;
}

/**
 * The link is the group's front door, so minting, moving and revoking it are
 * all the owner's — `manageInvitations`, the same permission that gates the
 * card these three are called from. A member who can see the link can still
 * share it; what they cannot do is change who else the group is open to.
 */
async function requireLinkAdmin(groupId: string, requireActive = false) {
  const access = await requireGroupAccess(groupId, { requireActive });
  requirePermission(access, "manageInvitations");
  return access;
}

function parseChoice(value: unknown): JoinLinkExpiryChoice {
  return isExpiryChoice(value) ? value : DEFAULT_JOIN_LINK_EXPIRY;
}

/** Mints the group's link, replacing whatever it had. */
export async function createJoinLinkAction(
  groupId: string,
  formData: FormData,
): Promise<ActionResult<JoinLinkResult>> {
  const choice = parseChoice(formData.get("expiry"));

  const result = await runAction("joinLink.create", async () => {
    const access = await requireLinkAdmin(groupId, true);
    const user = await getCurrentUser();
    const expiresAt = expiryDate(choice);

    const link = await createJoinLink(access.groupId, {
      createdByUserId: user?.userId ?? null,
      expiresAt,
    });

    return {
      url: joinLinkUrl(link.token),
      expiresAt: expiresAt?.toISOString() ?? null,
    };
  });

  if (result.ok) revalidateLink(groupId);
  return result;
}

/**
 * Moves the expiry, keeping the token.
 *
 * Extending a link that is about to lapse is the commonest thing anyone does
 * to it, and it has to be the harmless thing it sounds like: everybody who
 * already has the URL keeps it.
 */
export async function setJoinLinkExpiryAction(
  groupId: string,
  choice: string,
): Promise<ActionResult<{ expiresAt: string | null }>> {
  const parsed = parseChoice(choice);

  const result = await runAction("joinLink.setExpiry", async () => {
    const access = await requireLinkAdmin(groupId, true);
    const expiresAt = expiryDate(parsed);
    return {
      moved: await setJoinLinkExpiry(access.groupId, expiresAt),
      expiresAt: expiresAt?.toISOString() ?? null,
    };
  });

  if (!result.ok) {
    return actionError(result.error ?? "The expiry date could not be changed.");
  }
  // Revoked between opening the screen and choosing. The date has nowhere to
  // land, and saying so beats reporting a success that changed nothing.
  if (!result.data?.moved) {
    return actionError("This link is no longer active. Create a new one.");
  }

  revalidateLink(groupId);
  return actionOk({ expiresAt: result.data.expiresAt });
}

export async function revokeJoinLinkAction(
  groupId: string,
): Promise<ActionResult> {
  const result = await runAction("joinLink.revoke", async () => {
    const access = await requireLinkAdmin(groupId);
    await revokeJoinLink(access.groupId);
  });

  if (result.ok) revalidateLink(groupId);
  return result;
}

/**
 * Settings owns the card; People shows who has yet to walk through the link,
 * which is the number the card cross-links to. Both go stale together.
 */
function revalidateLink(groupId: string): void {
  revalidatePath(`/groups/${groupId}/settings`);
  revalidatePath(`/groups/${groupId}/members`);
}
