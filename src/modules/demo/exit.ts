/**
 * Where signing out goes.
 *
 * On a real instance this has always been `/` — the marketing homepage, which
 * is a reasonable place to be left standing. A demo has no such page: `/`
 * redirects to the sign-in screen there (see `src/app/page.tsx`), so returning
 * to `/` after signing out would put the visitor back on the screen they just
 * left, looking like the sign-out failed.
 *
 * So a demo sends them to the real site instead, if its operator said where
 * that is. Pure and separate from `actions.ts` because that file is
 * `"use server"` — every export there has to be an async action, which a rule
 * worth unit-testing should not have to be.
 */
export function signOutDestination(env: {
  DEMO_MODE: boolean;
  DEMO_EXIT_URL?: string | undefined;
}): string {
  if (!env.DEMO_MODE) return "/";
  // Straight to /sign-in rather than to `/`, which would only redirect there
  // a moment later: same destination, one round trip less.
  return env.DEMO_EXIT_URL ?? "/sign-in";
}
