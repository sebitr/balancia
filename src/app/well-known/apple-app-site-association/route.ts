import { APPLE_APP_SITE_ASSOCIATION } from "@/lib/apple-app-site-association";

/**
 * Serves the Apple App Site Association document.
 *
 * The public path is `/.well-known/apple-app-site-association`; this handler
 * sits one dot away from it because Next's file-system router skips
 * dot-prefixed directories under `app/`, so the obvious spelling
 * (`app/.well-known/…/route.ts`) is never routed and answers 404. The rewrite
 * in `next.config.ts` maps the public path onto this one — server-internal, so
 * the URL the client asked for is the URL it keeps. It must stay a rewrite:
 * Apple's fetcher refuses to follow a redirect and reports nothing when it
 * does.
 *
 * `Content-Type` is set by hand rather than left to `Response.json`, which
 * appends `; charset=utf-8`. The parameter is legal and Apple tolerates it,
 * but the requirement is written as the bare type and this file is not the
 * place to be interesting.
 *
 * Cacheable, because it is the same bytes for everybody and Apple's CDN is the
 * copy real devices actually read — an hour is short enough that a corrected
 * App ID propagates the same day and long enough that the origin is not asked
 * on every install.
 */
export function GET(): Response {
  return new Response(JSON.stringify(APPLE_APP_SITE_ASSOCIATION, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
