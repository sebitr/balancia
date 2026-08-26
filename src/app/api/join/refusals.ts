import "server-only";
import { getTranslations } from "next-intl/server";
import { NextResponse } from "next/server";
import { logger } from "@/lib/logger";
import { JoinLinkRefused, type JoinRefusalCode } from "@/modules/join/redeem";

/**
 * The answers the four join routes give when a link cannot be opened.
 *
 * Two things here depart from the rest of the mobile API, and both follow from
 * the same fact: these are the only responses in it a *reader* sees. The app
 * puts `error` straight into the sheet it opened when the link was tapped —
 * there is no screen in between to translate anything.
 *
 * **They are translated.** `app/api/mobile.ts` answers in English on purpose,
 * because a native client presents its own strings and translating there would
 * be translating twice. That reasoning does not reach this far: nothing on the
 * other side is holding a French copy of "this link has expired". The route
 * handlers the browser talks to have always translated — see the passkey and
 * push routes — and these follow those rather than the DTO helpers.
 *
 * **They carry a `code`.** The sentence is for the reader; the code is for the
 * program, so the app can stop showing the server's sentence the day it grows
 * its own, and so a failure can be told apart without matching on prose.
 *
 * The statuses divide the way the reader's options divide: 404 and 410 mean the
 * link is dead and only a new one helps, 409 means this account cannot have
 * that particular seat, 429 and 500 mean try again.
 */

/** Which kind of link was opened. Only the wording of `taken` turns on it. */
export type JoinLinkKind = "group" | "invitation";

/**
 * HTTP for each refusal.
 *
 * 404 rather than 410 for `invalid` keeps the distinction `resolveJoinLink`
 * already draws — never existed, versus existed and is over — because it is one
 * a reader can act on. A mistyped link is worth checking; an expired one is
 * worth asking the group about.
 */
const STATUS: Record<JoinRefusalCode, number> = {
  invalid: 404,
  expired: 410,
  revoked: 410,
  taken: 409,
};

/**
 * Keys under `serverErrors`, so these read like every other refusal.
 *
 * `taken` is the one that cannot be said once for both. On a group-wide link it
 * is a race for a name and the reader picks another; on a personal invitation
 * there is no other name — the link was minted for somebody else's account and
 * the only way forward is a fresh one.
 */
const MESSAGE_KEY = {
  group: {
    invalid: "joinLinkInvalid",
    expired: "joinLinkExpired",
    revoked: "joinLinkGone",
    taken: "joinNameTaken",
  },
  invitation: {
    invalid: "joinLinkInvalid",
    expired: "joinLinkExpired",
    revoked: "joinLinkGone",
    taken: "joinSeatClaimed",
  },
} as const satisfies Record<JoinLinkKind, Record<JoinRefusalCode, string>>;

type ErrorKey =
  | (typeof MESSAGE_KEY)[JoinLinkKind][JoinRefusalCode]
  | "rateLimited"
  | "authRequired"
  | "unavailable";

/** A refusal body: a sentence for the person, a code for the program. */
async function refusal(
  key: ErrorKey,
  code: string,
  status: number,
  headers: Record<string, string> = {},
): Promise<NextResponse> {
  const t = await getTranslations("serverErrors");
  return NextResponse.json(
    { error: t(key), code },
    { status, headers: { "Cache-Control": "private, no-store", ...headers } },
  );
}

/** 401, and the token is never looked at. */
export function requireSignIn(): Promise<NextResponse> {
  return refusal("authRequired", "authRequired", 401);
}

/** 429, carrying the wait the limiter asked for. */
export function tooManyAttempts(
  retryAfterSeconds: number,
): Promise<NextResponse> {
  return refusal("rateLimited", "rateLimited", 429, {
    "Retry-After": String(retryAfterSeconds),
  });
}

/**
 * Every other way one of these routes can end.
 *
 * A refusal is the link's own answer and is returned as written. Anything else
 * is a fault on this side: logged in full, reported as an anonymous 500 — the
 * same bargain `mobileApiError` strikes.
 */
export async function answerJoinFailure(
  error: unknown,
  kind: JoinLinkKind,
  route: string,
  context: Record<string, unknown> = {},
): Promise<NextResponse> {
  if (error instanceof JoinLinkRefused) {
    return refusal(
      MESSAGE_KEY[kind][error.code],
      error.code,
      STATUS[error.code],
    );
  }

  logger.error(
    {
      err:
        error instanceof Error ? (error.stack ?? error.message) : String(error),
      ...context,
    },
    `${route} failed`,
  );
  return refusal("unavailable", "unavailable", 500);
}
