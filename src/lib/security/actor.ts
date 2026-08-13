import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { resolveSession, SESSION_COOKIE_NAME } from "@/modules/auth/sessions";
import { GUEST_COOKIE_NAME, resolveGuestSession } from "./guest-session";
import type { Actor, UserActor } from "./authorization";

/**
 * Resolves the current actor from the incoming request.
 *
 * A signed-in user takes precedence over a guest cookie: if someone holds
 * both, they act as themselves. `cache` keeps this to one lookup per request
 * even when several Server Components ask.
 */
export const getCurrentActor = cache(async (): Promise<Actor | null> => {
  const cookieStore = await cookies();

  const sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const session = await resolveSession(sessionToken);
  if (session) {
    return {
      kind: "user",
      userId: session.userId,
      email: session.email,
      name: session.name,
    };
  }

  const guestToken = cookieStore.get(GUEST_COOKIE_NAME)?.value;
  const guest = await resolveGuestSession(guestToken);
  if (guest) {
    return {
      kind: "guest",
      groupId: guest.groupId,
      participantId: guest.participantId,
      displayName: guest.displayName,
      sessionId: guest.sessionId,
    };
  }

  return null;
});

/** The signed-in user, or null. Guests are not users. */
export const getCurrentUser = cache(async (): Promise<UserActor | null> => {
  const actor = await getCurrentActor();
  return actor?.kind === "user" ? actor : null;
});

/** Client IP for rate limiting, honouring a reverse proxy's headers. */
export async function getClientIp(): Promise<string> {
  const requestHeaders = await headers();
  const forwarded = requestHeaders.get("x-forwarded-for");
  if (forwarded) {
    const [first] = forwarded.split(",");
    if (first?.trim()) return first.trim();
  }
  return requestHeaders.get("x-real-ip")?.trim() ?? "unknown";
}
