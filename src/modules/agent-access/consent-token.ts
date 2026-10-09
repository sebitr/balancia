import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { CONSENT_TTL_SECONDS } from "./constants";

/**
 * The consent screen's memory of what it was asked, carried in the form.
 *
 * The screen is drawn from a request the client sent, and the button posts a
 * decision back to a different route. Everything the second route needs to
 * know about the first — which application, which address the answer goes to,
 * what challenge the code is bound to — has to cross that gap, and crossing it
 * in plain hidden fields would let a page that edits them change where the
 * code is sent after the person has read where it was going.
 *
 * So it crosses sealed. An HMAC over the whole request, under a key only this
 * instance holds, bound to the account that was shown the screen and good for
 * ten minutes. The decision route trusts nothing else in the form except the
 * two choices the person is actually making — how much, and which group — and
 * re-checks both.
 *
 * This is also the CSRF defence for the decision: a forged form cannot carry a
 * valid seal for the victim's account, and the session cookie is `SameSite=Lax`
 * besides.
 */

const payloadSchema = z.object({
  /** The account the screen was shown to. */
  u: z.uuid(),
  /** The client. */
  c: z.uuid(),
  /** Where the answer goes, exactly as the request named it. */
  r: z.string().min(1).max(2048),
  /** The PKCE challenge the code will be bound to. */
  h: z.string().min(1).max(128),
  /** The client's `state`, passed through. */
  s: z.string().max(1024).optional(),
  /** The most the request asked for. */
  m: z.enum(["read", "write"]),
  /** The `resource` the request named, if it did. */
  d: z.string().max(2048).optional(),
  /** Expiry, in seconds since the epoch. */
  x: z.number().int(),
});

export type ConsentPayload = z.infer<typeof payloadSchema>;

function sign(payload: string): string {
  return createHmac("sha256", getEnv().AUTH_SECRET)
    .update(`agent-consent.v1.${payload}`)
    .digest("base64url");
}

export function sealConsent(
  claims: Omit<ConsentPayload, "x">,
  now: Date = new Date(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      ...claims,
      x: Math.floor(now.getTime() / 1000) + CONSENT_TTL_SECONDS,
    } satisfies ConsentPayload),
    "utf8",
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The claims a seal carries, or null if it is forged, mangled or old. */
export function openConsent(
  sealed: unknown,
  now: Date = new Date(),
): ConsentPayload | null {
  if (typeof sealed !== "string") return null;
  const separator = sealed.lastIndexOf(".");
  if (separator <= 0) return null;
  const payload = sealed.slice(0, separator);
  const signature = Buffer.from(sealed.slice(separator + 1), "utf8");
  const expected = Buffer.from(sign(payload), "utf8");
  if (
    signature.length !== expected.length ||
    !timingSafeEqual(signature, expected)
  ) {
    return null;
  }

  let parsed: ReturnType<typeof payloadSchema.safeParse>;
  try {
    parsed = payloadSchema.safeParse(
      JSON.parse(Buffer.from(payload, "base64url").toString("utf8")),
    );
  } catch {
    return null;
  }
  if (!parsed.success) return null;
  if (parsed.data.x <= Math.floor(now.getTime() / 1000)) return null;
  return parsed.data;
}
