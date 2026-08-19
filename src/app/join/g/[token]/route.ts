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
  _request: Request,
  context: RouteContext<"/join/g/[token]">,
) {
  const { token } = await context.params;
  const env = getEnv();
  const fail = (reason: string) =>
    NextResponse.redirect(
      new URL(`/join/error?reason=${reason}`, env.appOrigin),
      { status: 303 },
    );

  const limit = await consumeRateLimit("joinRedeem", await getClientIp());
  if (!limit.allowed) return fail("rate-limited");

  try {
    const link = await resolveJoinLink(token);

    // Somebody already signed in has an identity, so there is nothing for the
    // flow to establish. If the account is in the group they are simply there;
    // if it is not, joining with an existing account is a path this feature
    // does not build yet, and the dashboard is where the app puts a signed-in
    // reader who arrived somewhere with nothing for them.
    //
    // The check belongs here rather than on `/join/start`, which cannot
    // redirect at all — see the note there.
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
      return NextResponse.redirect(
        new URL(
          member ? `/groups/${link.groupId}` : "/dashboard",
          env.appOrigin,
        ),
        { status: 303 },
      );
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
