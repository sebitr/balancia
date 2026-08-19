"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
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
  resolveJoinLink,
  revokeJoinLink,
  setJoinLinkExpiry,
} from "@/lib/security/join-link";
import { requirePermission } from "@/lib/security/authorization";
import { consumeRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import {
  clearJoinCookie,
  readJoinCookie,
  setSessionCookie,
} from "@/modules/auth/cookies";
import { registerUser } from "@/modules/auth/service";
import { getClientIp } from "@/lib/security/actor";
import { resolveRequestLocale } from "@/i18n/request";
import { headers } from "next/headers";
import {
  DEFAULT_JOIN_LINK_EXPIRY,
  expiryDate,
  isExpiryChoice,
  type JoinLinkExpiryChoice,
} from "./expiry";
import { claimMember, createMember, type JoinOutcome } from "./service";

/**
 * The join flow's mutations, and the two that manage the link behind it.
 *
 * Finishing the flow does two things at once — it creates an account and it
 * puts that account in the group — and they have to succeed or fail together
 * from the reader's point of view. They cannot literally share a transaction,
 * because registration owns its own; so the order is: register, then join, and
 * a failed join leaves a usable account rather than a half-made one. That is
 * the recoverable direction. The reverse would strand a participant row
 * pointing at a user that does not exist.
 */

/**
 * Same shape as the auth module's private helper of this name. It is private
 * there, and duplicating four lines is better than widening that module's
 * surface for one caller.
 */
async function requestContext(): Promise<{
  userAgent: string | null;
  ipAddress: string;
  locale: string;
}> {
  const requestHeaders = await headers();
  return {
    userAgent: requestHeaders.get("user-agent"),
    ipAddress: await getClientIp(),
    locale: await resolveRequestLocale(),
  };
}

const finishSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter a password."),
  name: z.string().trim().min(2, "Enter your name.").max(120),
  /** Null on the "add me as new" path. */
  participantId: z.uuid().nullable(),
});

export interface JoinResult {
  readonly groupId: string;
  readonly participantId: string | null;
  readonly claimed: boolean;
  /** True when the instance mails a confirmation before issuing a session. */
  readonly verificationRequired: boolean;
  /** Set when the name was taken between choosing it and confirming. */
  readonly taken: boolean;
}

/**
 * Creates the account and joins the group.
 *
 * The link is re-resolved from the cookie here rather than trusted from the
 * client: the group being joined must come from the credential, never from the
 * form, or the form could name any group it liked.
 */
export async function finishJoinAction(
  input: unknown,
): Promise<ActionResult<JoinResult>> {
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) {
    return actionError(parsed.error.issues[0]?.message ?? "Check the form.");
  }

  const context = await requestContext();
  return runAction("join.finish", async () => {
    const limit = await consumeRateLimit("signUp", context.ipAddress);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);

    const link = await resolveJoinLink(await readJoinCookie());

    const registration = await registerUser(
      {
        email: parsed.data.email,
        password: parsed.data.password,
        name: parsed.data.name,
      },
      context,
    );

    const outcome: JoinOutcome = parsed.data.participantId
      ? await claimMember({
          groupId: link.groupId,
          participantId: parsed.data.participantId,
          userId: registration.user.userId,
        })
      : await createMember({
          groupId: link.groupId,
          userId: registration.user.userId,
          displayName: parsed.data.name,
        });

    // A session only exists when the instance has no mail server; otherwise
    // the account is real but unconfirmed, and the done screen says so.
    if (registration.session) {
      await setSessionCookie(
        registration.session.token,
        registration.session.expiresAt,
      );
    }

    // The decision is made either way, so the cookie has no further use. A
    // lost race clears it too: retrying needs a fresh read of the list.
    await clearJoinCookie();

    if (outcome.status === "taken") {
      return {
        groupId: link.groupId,
        participantId: null,
        claimed: false,
        verificationRequired: registration.verificationRequired,
        taken: true,
      };
    }

    revalidatePath(`/groups/${link.groupId}`);
    return {
      groupId: link.groupId,
      participantId: outcome.participantId,
      claimed: parsed.data.participantId !== null,
      verificationRequired: registration.verificationRequired,
      taken: false,
    };
  });
}

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
