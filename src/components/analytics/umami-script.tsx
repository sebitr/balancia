import { headers } from "next/headers";
import { readUmamiConfig } from "@/lib/analytics/umami";

/**
 * The tracker tag, for the public pages only.
 *
 * Mounted in `src/app/page.tsx` and `src/app/(auth)/layout.tsx` — the landing
 * page and the sign-in/registration screens. Not in the root layout, and not
 * anywhere under `(app)/` or `groups/`, because every path there names a group
 * or an expense and a page view carries the path. `umami-script.test.tsx`
 * fails if this file is imported from anywhere else.
 *
 * The two attributes below are load-bearing rather than decorative:
 *
 * `data-exclude-search` — `/sign-in?next=/groups/{id}` is written by
 *   `groups/[groupId]/layout.tsx` when a signed-out reader opens a group
 *   link, and `/register/done?group={id}` by registration. Both are public
 *   pages with a group identifier in the query string. Without this the
 *   identifier goes to the analytics host; with it the tracker reports
 *   `/sign-in` and stops.
 *
 * `data-do-not-track` — honours the browser's Do Not Track signal. It costs a
 *   little accuracy on a number nothing depends on.
 */
export async function UmamiScript() {
  const config = readUmamiConfig();
  if (!config) return null;

  // Set by `proxy.ts` on every request it matches, which is every page route.
  // Without it the Content-Security-Policy blocks the tag: `'strict-dynamic'`
  // means host allowlists are ignored and the nonce is the only thing that
  // authorizes a script.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <script
      defer
      src={config.scriptUrl}
      nonce={nonce}
      data-website-id={config.websiteId}
      data-exclude-search="true"
      data-do-not-track="true"
    />
  );
}
