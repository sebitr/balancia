import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { participants } from "@/lib/db/schema";
import { getClientIp, getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  InvalidJoinLinkError,
  resolveJoinLink,
  touchJoinLink,
} from "@/lib/security/join-link";
import { setJoinCookie } from "@/modules/auth/cookies";
import { isLinkPreviewCrawler } from "@/lib/link-preview";
import { joinLinkPreviewResponse } from "@/modules/join/preview";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Where a group join link lands.
 *
 * Same shape as `/join/[token]` next door, and for the same reason: the token
 * appears in the URL exactly once, for the length of this request, and the
 * 303 sends the browser to a URL that does not contain it. What differs is
 * what is handed on — a per-participant link mints a guest session, whereas
 * this one only puts the link's own token in a cookie, because nobody has been
 * identified yet. Deciding who this person is is the job of `/join/start`.
 *
 * No activity is recorded here. Opening a link that five people were sent is
 * not an event in the group's history; joining is, and that is recorded when
 * the flow finishes.
 */
export async function GET(
  request: Request,
  context: RouteContext<"/join/g/[token]">,
) {
  const { token } = await context.params;
  const env = getEnv();
  const fail = (reason: string) =>
    NextResponse.redirect(
      new URL(`/join/error?reason=${reason}`, env.appOrigin),
      { status: 303 },
    );

  /*
   * A chat app drawing the bubble, seconds before anybody taps it.
   *
   * It is answered with a document rather than the redirect, because a
   * redirect carries no meta tag and there is nothing else in a bubble. It
   * gets no cookie and the link is not stamped as used: the organiser's card
   * says when the link was last opened, and a crawler has not opened it.
   *
   * The rate limit is the one the humans use, deliberately. The preview reads
   * the same token space by the same hash, so leaving it unmetered would put
   * an unmetered oracle beside a metered one — and since a crawler arrives
   * from a datacentre and a household does not, the two never share a bucket
   * in practice. A refusal falls through to the app's own card rather than
   * an error: a bubble is not the place to say we are rate-limiting somebody.
   */
  if (isLinkPreviewCrawler(request.headers.get("user-agent"))) {
    const budget = await consumeRateLimit("joinRedeem", await getClientIp());
    const preview = budget.allowed
      ? await resolveJoinLink(token).catch(() => null)
      : null;
    return joinLinkPreviewResponse(
      `/join/g/${token}`,
      preview
        ? {
            kind: "group",
            groupName: preview.groupName,
            groupIcon: preview.groupIcon,
            groupIconColor: preview.groupIconColor,
            inviterName: preview.inviterName,
          }
        : { kind: "dead" },
    );
  }

  const limit = await consumeRateLimit("joinRedeem", await getClientIp());
  if (!limit.allowed) return fail("rate-limited");

  try {
    const link = await resolveJoinLink(token);

    /*
     * Somebody already signed in, which is one situation and not two.
     *
     * An account that is already in the group has nowhere to be sent but the
     * group: there is no identity to establish and no name left to claim. An
     * account that is *not* in it is exactly who the link is for — they simply
     * arrive holding the account the flow would otherwise have asked them to
     * make, so they get the same cookie and the same screens, and `/join/start`
     * drops the credential half of the route.
     *
     * The membership check belongs here rather than on `/join/start`, which
     * cannot redirect at all — see the note there.
     */
    const viewer = await getCurrentUser();
    if (viewer) {
      const [member] = await getDb()
        .select({ id: participants.id })
        .from(participants)
        .where(
          and(
            eq(participants.groupId, link.groupId),
            eq(participants.userId, viewer.userId),
          ),
        )
        .limit(1);
      if (member) {
        return NextResponse.redirect(
          new URL(`/groups/${link.groupId}`, env.appOrigin),
          { status: 303 },
        );
      }
    }

    await setJoinCookie(token);
    // Best effort: a link that works must not fail to open because the
    // bookkeeping write did.
    void touchJoinLink(link.linkId).catch(() => undefined);

    logger.info(
      { groupId: link.groupId, linkId: link.linkId },
      "Group join link opened",
    );

    return NextResponse.redirect(new URL("/join/start", env.appOrigin), {
      status: 303,
    });
  } catch (error) {
    if (error instanceof InvalidJoinLinkError) return fail(error.reason);
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Group join link resolution failed",
    );
    return fail("unavailable");
  }
}
