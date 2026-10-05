import { headers } from "next/headers";
import { pageBridge } from "@/lib/analytics/bridge";
import { publicPageAnalytics } from "@/lib/analytics/umami";

/**
 * The page counter, for the public pages only, and only once an administrator
 * has switched telemetry on.
 *
 * Mounted by the public pages' shell, by `src/app/(auth)/layout.tsx` and by
 * `src/app/register/layout.tsx` — the homepage, the comparison pages, and the
 * sign-in and registration screens. Not in the root layout, and not anywhere
 * under `(app)/` or `groups/`, because every path there names a group or an
 * expense and a page view carries the path. `umami-script.test.tsx` fails if
 * this file is imported from anywhere else.
 *
 * Where it is mounted decides who loads the tracker. It does not decide what
 * the tracker reports afterwards: one loaded on `/sign-in` is still running
 * once the reader has signed in and moved on, and it counts every navigation
 * it sees. So what is rendered here is not the tracker's tag. It is one
 * inline script — `lib/analytics/bridge.ts` — which first defines the hook
 * every message must pass on its way out, and only then writes the tag
 * itself. The tracker cannot arrive without its gate, because the gate is
 * what brings it.
 *
 * The attributes that script gives the tag are load-bearing rather than
 * decorative:
 *
 * `data-before-send` — names the hook. It sends nothing from an address that
 *   is not a public page, whatever the tracker thinks it is counting, and it
 *   is the one way a campaign label gets back through the door the next
 *   attribute closes.
 *
 * `data-exclude-search` — `/sign-in?next=/groups/{id}` is written by
 *   `groups/[groupId]/layout.tsx` when a signed-out reader opens a group
 *   link, and `/register/done?group={id}` by registration. Both are public
 *   pages with a group identifier in the query string. Without this the
 *   identifier goes to the collector; with it the tracker reports `/sign-in`
 *   and stops.
 *
 * `data-do-not-track` — honours the browser's Do Not Track signal. It costs a
 *   little accuracy on a number nothing depends on.
 *
 * `data-performance` — how long the page took to draw, as the browser
 *   measured it: five timings, no content. A public page that is slow is a
 *   public page a search engine ranks lower, and this is the only place the
 *   real figure can come from.
 */
export async function UmamiScript() {
  const analytics = await publicPageAnalytics();
  if (!analytics) return null;

  // Set by `proxy.ts` on every request it matches, which is every page route.
  // Without it the Content-Security-Policy blocks the script: `'strict-dynamic'`
  // means host allowlists are ignored and the nonce is the only thing that
  // authorizes one. The tracker it goes on to load is covered by the same
  // keyword — a script a trusted script creates is trusted.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <script
      nonce={nonce}
      dangerouslySetInnerHTML={{ __html: pageBridge(analytics) }}
    />
  );
}
