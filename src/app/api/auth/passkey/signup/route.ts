import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { getClientIp, getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";
import { AuthError } from "@/modules/auth/service";
import { finishPasskeySignup, startPasskeySignup } from "@/modules/auth/signup";
import { settleNewSession } from "@/modules/auth/session-handoff";

/**
 * Creating an account with a passkey, for somebody who has none yet.
 *
 * POST → options (with a server-issued challenge), given the name and address
 *        the account would be created with
 * PUT  → verify the authenticator's response, create the account, sign it in
 *
 * The sibling `/register` route does the same ceremony for a user who is
 * already signed in and is adding a credential. This one is unauthenticated by
 * definition, which is why the rate limit is the signup bucket and why the
 * options step refuses a signed-in caller: somebody with a session who wants
 * another passkey wants that route, and letting this one answer them would be
 * a way to make a second account without leaving the first.
 *
 * Options come from a POST rather than a GET because they take a body and
 * because issuing a challenge is a write. PUT finishes, keeping both halves on
 * one path.
 */

const identitySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email(),
});

const finishSchema = z.object({
  response: z.looseObject({ id: z.string() }),
  /** Present only when a shared link put a member list in front of them. */
  join: z
    .object({
      participantId: z.uuid().nullable().default(null),
      displayName: z.string().trim().max(120).default(""),
    })
    .optional(),
});

export async function POST(request: Request) {
  return trackRoute("/api/auth/passkey/signup", "POST", () =>
    handleStart(request),
  );
}

async function handleStart(request: Request) {
  if (await getCurrentUser()) {
    return NextResponse.json(
      { error: "You are already signed in." },
      { status: 409 },
    );
  }

  const parsed = identitySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your name and email address." },
      { status: 400 },
    );
  }

  const limit = await consumeRateLimit("signUp", await getClientIp());
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  try {
    const options = await startPasskeySignup(parsed.data);
    return NextResponse.json(options, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error, "Could not start a passkey signup.");
  }
}

export async function PUT(request: Request) {
  return trackRoute("/api/auth/passkey/signup", "PUT", () =>
    handleFinish(request),
  );
}

async function handleFinish(request: Request) {
  if (await getCurrentUser()) {
    return NextResponse.json(
      { error: "You are already signed in." },
      { status: 409 },
    );
  }

  const parsed = finishSchema.safeParse(await readJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: "Try that again." }, { status: 400 });
  }

  try {
    const created = await finishPasskeySignup(
      parsed.data.response as unknown as RegistrationResponseJSON,
      await context(request),
    );
    // The same three steps every other new session takes: the cookie, the
    // guest identity this browser was holding, and the group whose link it
    // arrived on.
    const settled = await settleNewSession(
      created.user.userId,
      created.session,
      { join: parsed.data.join },
    );
    // The group has a new member; its pages were rendered without them.
    if (settled.joinedGroupId) {
      revalidatePath(`/groups/${settled.joinedGroupId}`);
    }
    return NextResponse.json(settled, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return failure(error, "That passkey could not be registered.");
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function context(request: Request) {
  return {
    userAgent: request.headers.get("user-agent"),
    ipAddress: await getClientIp(),
  };
}

/**
 * An `AuthError` is something the reader can act on — the address is taken,
 * the ceremony expired — and is theirs to read. Anything else is ours.
 */
function failure(error: unknown, fallback: string) {
  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  logger.error(
    { err: error instanceof Error ? error.message : String(error) },
    "Passkey signup failed",
  );
  return NextResponse.json({ error: fallback }, { status: 500 });
}
