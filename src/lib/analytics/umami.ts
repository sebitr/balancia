import { getEffectiveTelemetry } from "@/lib/telemetry/settings";

/**
 * Page counts for the pages a stranger sees.
 *
 * Not a second thing to consent to. Balancia asks once — the telemetry
 * switch in Settings → Administration → Telemetry — and that one answer
 * governs both what it sends: the weekly usage report, and the counts for the
 * four public pages. With telemetry off, which is the default and the whole
 * of a self-hosted install until an administrator says otherwise, no tracker
 * is loaded and no request is made. There is no variable that turns this on
 * by itself, for the same reason there is none for telemetry.
 *
 * Where the counts go is compiled in below and is not configurable, so what
 * an administrator decides is *whether*, never *to whom*.
 *
 * The boundary is the other half of the design, and it is not a setting
 * either: the tracker is mounted on the public surface and nowhere else.
 * Every other page in Balancia has a group or an expense identifier in its
 * path, and a page view carries the path. There is no configuration of Umami
 * that makes `/groups/f0a42f94-…/expenses/9f63…` safe to send anywhere, so
 * the answer is not to send it — the script is never on those pages at all.
 * `umami-script.test.tsx` holds it there.
 *
 * See docs/telemetry.md §17.
 */

/**
 * The tracker, and by derivation the only third-party origin the
 * Content-Security-Policy admits.
 *
 * Compiled in rather than configured, for the reason the telemetry endpoint
 * is: an address that can be set is a lever. From an environment file it is
 * one more thing anyone who talks their way onto the box can move, and one
 * more thing a self-hoster can be talked into changing. More importantly it
 * would make every statement in `docs/telemetry.md` §17 conditional — each
 * one would quietly carry "…unless somebody changed it", and a reader would
 * have to go and check the environment before believing any of it.
 *
 * With a constant, the network-level check is one hostname: blocking
 * telemetry.balancia.app is enough to be certain, whatever the settings say —
 * the same hostname that already covers the weekly report.
 *
 * A fork edits this line. Under the AGPL it is building from source to do
 * that anyway, so the cost is close to nothing next to the claim above.
 */
export const UMAMI_SCRIPT_URL = "https://telemetry.balancia.app/script.js";

/**
 * Which website in that Umami these counts belong to.
 *
 * **Empty, and nothing is sent while it is.** The collector's Umami issues
 * this UUID; until it is pasted here the tag is never rendered and the CSP is
 * never widened, whatever the telemetry switch says. That is the safe
 * direction to be wrong in — a placeholder that looked plausible would send
 * real page views to a website that does not exist, and the symptom would be
 * a week of wondering why the dashboard is empty.
 *
 * It lives here rather than in the environment because it is the other half
 * of "who is being told". Both halves in one file is what lets the
 * documentation say where page views go without qualifying it.
 */
export const UMAMI_WEBSITE_ID = "";

/**
 * Umami website IDs are UUIDs. Checked so that a mistyped constant fails a
 * test rather than sending data that lands under no website.
 */
const WEBSITE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type UmamiConfig = {
  /** Absolute URL of the tracker script. */
  scriptUrl: string;
  /** The website these counts belong to. */
  websiteId: string;
  /**
   * Origin the tracker POSTs to — Umami sends to `/api/send` on the host it
   * was loaded from, so this is derived rather than stated separately and the
   * script tag and the CSP cannot describe different hosts.
   */
  origin: string;
};

/**
 * The destination, or null when there is not one yet.
 *
 * Pure and synchronous, because `proxy.ts` calls it on every request to
 * decide one Content-Security-Policy directive and must not touch the
 * database to do it. Says nothing about consent — `publicPageAnalytics` is
 * the function that asks about that.
 */
export function umamiDestination(
  websiteId: string = UMAMI_WEBSITE_ID,
): UmamiConfig | null {
  const id = websiteId.trim();
  if (id === "" || !WEBSITE_ID.test(id)) return null;

  return {
    scriptUrl: UMAMI_SCRIPT_URL,
    websiteId: id,
    origin: new URL(UMAMI_SCRIPT_URL).origin,
  };
}

/**
 * What the public pages should render: the destination, but only once an
 * administrator has switched telemetry on.
 *
 * `transmitting` rather than `recording` is the right question. Recording is
 * also true in `TELEMETRY_MODE=local`, where the promise is that nothing
 * leaves this server — loading a tracker there would break it. Transmitting
 * is exactly "this instance sends data to Balancia", which is the consent a
 * page count needs too.
 *
 * `getEffectiveTelemetry` never throws and answers "off" when it cannot read
 * the database, so an instance that cannot check its own settings loads
 * nothing rather than guessing about consent.
 */
export async function publicPageAnalytics(
  websiteId: string = UMAMI_WEBSITE_ID,
): Promise<UmamiConfig | null> {
  const destination = umamiDestination(websiteId);
  // Ordering, not an optimisation: a build with nowhere to send anything must
  // not query the database on a stranger's page view to find that out.
  if (!destination) return null;

  const telemetry = await getEffectiveTelemetry();
  return telemetry.transmitting ? destination : null;
}
