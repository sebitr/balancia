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
import { redeemInvitation } from "@/lib/security/guest-session";
import {
  createJoinLink,
  joinLinkUrl,
  resolveJoinLink,
  revokeJoinLink,
  setJoinLinkExpiry,
} from "@/lib/security/join-link";
import {
  clearJoinCookie,
  readJoinCookie,
  setGuestCookie,
} from "@/modules/auth/cookies";
import {
  AuthenticationRequiredError,
  requirePermission,
} from "@/lib/security/authorization";
import { JoinError, joinAsGuest } from "./service";
import { joinFromLink } from "./signup-join";
import {
  DEFAULT_JOIN_LINK_EXPIRY,
  expiryDate,
  isExpiryChoice,
  type JoinLinkExpiryChoice,
} from "./expiry";

/**
 * The join link's own mutations: minting it, moving its expiry, revoking it —
 * and the one join that finishes here.
 *
 * A join that *creates* an account is not in this file. The credential half of
 * that happens in three different places — a Server Action for a code, a route
 * handler for a passkey, a second request for either — so the group half moved
 * to `signup-join.ts`, which all three end in. What is left here is the fourth
 * way in, which has no credential half to wait for: a reader who opened the
 * link already signed in. For them there is nothing to create, so the group
 * half is the whole thing, and it is a Server Action like any other.
 */

/**
 * Puts the signed-in account into the group its join cookie names.
 *
 * The group is not a parameter, and that is the whole security argument: it is
 * re-resolved from the cookie inside `joinFromLink`, so a caller may say which
 * *participant* it is claiming — the list it chose from came from the link —
 * but never which group it is claiming it in. Naming the group here would let
 * any signed-in request name any group it liked.
 *
 * Both failures are races rather than mistakes: a link revoked while somebody
 * was reading the list, and a name taken by whoever tapped first. They are
 * refusals with sentences on them, not errors, so the screen the reader is
 * standing on can say what happened and let them pick again.
 */
export async function joinWithAccountAction(member: {
  participantId: string | null;
  displayName: string;
}): Promise<ActionResult<{ groupId: string }>> {
  const result = await runAction("join.withAccount", async () => {
    const user = await getCurrentUser();
    if (!user) throw new AuthenticationRequiredError();

    const joined = await joinFromLink(user.userId, {
      participantId: member.participantId,
      displayName: member.displayName.trim(),
    });

    // No cookie, or one that no longer resolves. `joinFromLink` has already
    // cleared it, so there is nothing to retry with and nothing was changed.
    if (!joined) {
      throw new JoinError(
        "This link is no longer active. Ask the group for a new one.",
        "joinLinkGone",
      );
    }
    if (joined.status === "taken") {
      throw new JoinError(
        "Somebody else claimed that name first. Open the link again to pick another.",
        "joinNameTaken",
      );
    }

    return { groupId: joined.groupId };
  });

  if (result.ok && result.data) {
    // The group gained a member, and the dashboard gained a group.
    revalidatePath(`/groups/${result.data.groupId}`);
    revalidatePath(`/groups/${result.data.groupId}/members`);
    revalidatePath("/dashboard");
  }
  return result;
}

/**
 * Puts a guest into the group its join cookie names.
 *
 * The fifth way in, and until now the one that went nowhere: the "keep it"
 * screen offered "Continue as a guest" on a shared link, and choosing it
 * created neither a participant nor a session, so "Go to the group" opened the
 * sign-in page. A guest session has always been minted by spending a personal
 * invitation, so that is what this does — it mints one for the participant
 * the joiner claimed or typed, on the group's behalf, and spends it at once.
 *
 * The group comes from the cookie for the same reason as above; the caller
 * may only say which listed name is theirs, or which name to file under.
 */
export async function joinAsGuestAction(member: {
  participantId: string | null;
  displayName: string;
}): Promise<ActionResult<{ groupId: string }>> {
  const result = await runAction("join.asGuest", async () => {
    const cookie = await readJoinCookie();
    const link = cookie
      ? await resolveJoinLink(cookie).catch(() => null)
      : null;
    if (!link) {
      await clearJoinCookie();
      throw new JoinError(
        "This link is no longer active. Ask the group for a new one.",
        "joinLinkGone",
      );
    }

    const outcome = await joinAsGuest({
      groupId: link.groupId,
      participantId: member.participantId,
      displayName: member.displayName.trim(),
    });
    await clearJoinCookie();

    if (outcome.status === "taken") {
      throw new JoinError(
        "Somebody else claimed that name first. Open the link again to pick another.",
        "joinNameTaken",
      );
    }

    // Spend the invitation this join minted, exactly as opening a personal
    // link would: the session token goes in the cookie, the invitation token
    // goes nowhere.
    const redeemed = await redeemInvitation(outcome.invitationToken);
    await setGuestCookie(redeemed.token, redeemed.expiresAt);

    return { groupId: link.groupId };
  });

  if (result.ok && result.data) {
    revalidatePath(`/groups/${result.data.groupId}`);
    revalidatePath(`/groups/${result.data.groupId}/members`);
  }
  return result;
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
