import "server-only";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { getEnv } from "@/lib/env";
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

/**
 * Picks the client address out of a request's forwarding headers.
 *
 * `X-Forwarded-For` is not a list of facts. A client may send one, and every
 * proxy Balancia documents *appends* the peer it saw rather than replacing what
 * arrived — nginx's `$proxy_add_x_forwarded_for`, Caddy and Traefik all behave
 * this way. So the leftmost entry is whatever the caller typed, and reading it
 * let one attacker present a fresh address per request and walk through every
 * limit keyed on this: sign-in, sign-up, password reset, join redemption.
 *
 * Entries are therefore counted from the *right*, where the proxies are. The
 * last was written by the proxy Balancia sits behind, the one before it by the
 * proxy in front of that, and so on; `hops` says how many there are.
 * Everything to the left of that point is the caller's to invent.
 *
 * `X-Real-IP` is only consulted when there is no `X-Forwarded-For` at all.
 * nginx sets it to `$remote_addr`, which a client cannot state — but Caddy and
 * Traefik do not set it, and would pass a client's own straight through, so it
 * cannot be preferred over the header the proxy is known to have written.
 *
 * Pure, and exported, because this is the whole of the decision: which bytes
 * of a request a rate limit is allowed to believe.
 */
export function clientIpFrom(
  forwardedFor: string | null,
  realIp: string | null,
  hops: number,
): string {
  const entries = (forwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length > 0) {
    // Fewer entries than there are proxies means the chain is shorter than
    // configured — nothing in the list came from the client, so the leftmost
    // is the outermost proxy's view and the best answer available.
    const index = Math.max(0, entries.length - Math.max(1, hops));
    return entries[index];
  }

  const direct = realIp?.trim();
  return direct && direct.length > 0 ? direct : "unknown";
}

/** Client IP for rate limiting, honouring a reverse proxy's headers. */
export async function getClientIp(): Promise<string> {
  const requestHeaders = await headers();
  return clientIpFrom(
    requestHeaders.get("x-forwarded-for"),
    requestHeaders.get("x-real-ip"),
    getEnv().TRUSTED_PROXY_HOPS,
  );
}
