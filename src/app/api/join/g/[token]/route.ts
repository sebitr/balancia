import { z } from "zod";
import { getClientIp, getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { previewGroupLink, redeemGroupLink } from "@/modules/join/redeem";
import { invalidInput, noStore, readJsonBody } from "@/app/api/mobile";
import {
  answerJoinFailure,
  requireSignIn,
  tooManyAttempts,
} from "@/app/api/join/refusals";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The group-wide join link, for a client that has no cookies to hand.
 *
 * `/join/g/<token>` next door is a browser route: it spends the token into a
 * cookie and redirects, so merely *looking* at a link there is already taking
 * it. That is unusable from an app, which has to show what the link is before
 * anybody agrees to it — hence the split here, which is the one thing about
 * this pair that is not negotiable:
 *
 *   GET   reads the link. Touches nothing. Safe to call twice.
 *   POST  takes it, and is the only half that needs an account.
 *
 * The path mirrors the web's two namespaces rather than collapsing into one
 * `/api/join/:token`, because a group token and an invitation token live in
 * different tables and the client always knows which kind it holds — the URL it
 * was opened with said so.
 */

export async function GET(
  _request: Request,
  context: RouteContext<"/api/join/g/[token]">,
) {
  return trackRoute("/api/join/g/[token]", "GET", () => handleGet(context));
}

/**
 * Reading a group link, signed in or not.
 *
 * Answering anonymously is deliberate. The link is the authority — that is the
 * rule the whole join flow rests on, stated in `modules/join/service.ts` — and
 * what comes back is what the web already shows any holder of one: the group's
 * name, its size, who made the link. Asking somebody to sign in before telling
 * them *what* they are being asked to join is a worse trade than it looks:
 * they would be creating an account to read an invitation they might decline.
 *
 * `alreadyMember` is the one field that needs a reader, and it is simply false
 * for a caller the request cannot name.
 */
async function handleGet(context: RouteContext<"/api/join/g/[token]">) {
  const { token } = await context.params;

  const limit = await consumeRateLimit("joinRedeem", await getClientIp());
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds);

  try {
    const user = await getCurrentUser();
    return noStore(await previewGroupLink(token, user?.userId ?? null));
  } catch (error) {
    return answerJoinFailure(error, "group", "/api/join/g/[token] GET");
  }
}

/**
 * The fork the web offers on `/join/start`, as a request body.
 *
 * Naming a `participantId` claims one of the seats the group is already keeping
 * for somebody with no account. Naming nothing arrives as a new participant
 * under the name on the account, which is what a sheet with no list to offer
 * does. `displayName` is for the case where the joiner would rather be called
 * something else in this group than on their account.
 */
const takeLinkSchema = z.object({
  participantId: z.uuid().optional(),
  displayName: z.string().trim().min(1, "Enter a name").max(120).optional(),
});

export async function POST(
  request: Request,
  context: RouteContext<"/api/join/g/[token]">,
) {
  return trackRoute("/api/join/g/[token]", "POST", () =>
    handlePost(request, context),
  );
}

async function handlePost(
  request: Request,
  context: RouteContext<"/api/join/g/[token]">,
) {
  const { token } = await context.params;

  const limit = await consumeRateLimit("joinRedeem", await getClientIp());
  if (!limit.allowed) return tooManyAttempts(limit.retryAfterSeconds);

  // Before the token is resolved, so a signed-out caller cannot use this route
  // to find out whether a link is live.
  const user = await getCurrentUser();
  if (!user) return requireSignIn();

  const body = await readJsonBody(request);
  const raw =
    body !== undefined && typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const parsed = takeLinkSchema.safeParse({
    participantId: raw.participantId ?? undefined,
    displayName: raw.displayName ?? undefined,
  });
  if (!parsed.success) return invalidInput(parsed.error);

  try {
    // 200 rather than 201: an account that is already in the group gets the
    // same body from the same call, and a double tap must not read as a
    // failure. Nothing here is a new resource the second time.
    return noStore(
      await redeemGroupLink({
        token,
        userId: user.userId,
        participantId: parsed.data.participantId ?? null,
        displayName: parsed.data.displayName ?? user.name,
      }),
    );
  } catch (error) {
    return answerJoinFailure(error, "group", "/api/join/g/[token] POST");
  }
}
