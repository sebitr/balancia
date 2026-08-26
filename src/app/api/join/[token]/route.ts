import { getClientIp, getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { previewInvitation, redeemInvitationAs } from "@/modules/join/redeem";
import { noStore } from "@/app/api/mobile";
import {
  answerJoinFailure,
  requireSignIn,
  tooManyAttempts,
} from "@/app/api/join/refusals";
import { trackRoute } from "@/lib/metrics/http";

/**
 * A personal invitation, for a client that has no cookies to hand.
 *
 * Same split as `/api/join/g/[token]` next door and for the same reason — the
 * web route spends the token on sight, so an app that fetched it to see what it
 * was would have taken it. `GET` reads and changes nothing; `POST` takes it.
 *
 * What differs from the group-wide link is that there is no fork and no body:
 * this token names one seat in one group, so the only question `POST` asks is
 * whether this account may have it.
 *
 * It also mints no guest session, which the web route does. On the web this
 * link is how somebody with no account gets into a group at all, and the guest
 * session stands in for the membership they have not got. A caller here already
 * has an account, so the invitation resolves straight to the real thing.
 */

export async function GET(
  _request: Request,
  context: RouteContext<"/api/join/[token]">,
) {
  return trackRoute("/api/join/[token]", "GET", () => handleGet(context));
}

/**
 * Reading an invitation, signed in or not.
 *
 * Anonymous for the same reason as the group link: the app has to be able to
 * say "Ellie invited you to Lisbon Trip" before it asks anybody to sign in.
 * This one says a little more — `participantName`, the seat being held — which
 * is what the holder of the link was already sent in the message carrying it.
 */
async function handleGet(context: RouteContext<"/api/join/[token]">) {
  const { token } = await context.params;

  const limit = await consumeRateLimit("guestRedeem", await getClientIp());
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds);

  try {
    const user = await getCurrentUser();
    return noStore(await previewInvitation(token, user?.userId ?? null));
  } catch (error) {
    return answerJoinFailure(error, "invitation", "/api/join/[token] GET");
  }
}

export async function POST(
  _request: Request,
  context: RouteContext<"/api/join/[token]">,
) {
  return trackRoute("/api/join/[token]", "POST", () => handlePost(context));
}

async function handlePost(context: RouteContext<"/api/join/[token]">) {
  const { token } = await context.params;

  const limit = await consumeRateLimit("guestRedeem", await getClientIp());
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds);

  // Before the token is resolved, so a signed-out caller cannot use this route
  // to find out whether an invitation is live.
  const user = await getCurrentUser();
  if (!user) return requireSignIn();

  try {
    // 200, and idempotent: an account already sitting in that seat gets the
    // same body back rather than a conflict.
    return noStore(await redeemInvitationAs({ token, userId: user.userId }));
  } catch (error) {
    return answerJoinFailure(error, "invitation", "/api/join/[token] POST");
  }
}
