import type { ProviderChoice } from "@/components/backup/provider-mark";
import type { SetupStep } from "./types";

/**
 * The wizard's address, written in one place.
 *
 * The step lives in the URL so the browser's Back button walks the steps, and
 * so a reload lands where the person was. Nothing else belongs in it: not a
 * key, not a bucket's secret, not a typed address — those stay in the page's
 * memory, and a reload is allowed to lose them.
 */

export const SETUP_PATH = "/settings/backup/setup";
export const OVERVIEW_PATH = "/settings/backup";

export function setupUrl(params: {
  step: SetupStep;
  provider?: ProviderChoice | null;
  /** The id of the connection waiting in `setup`. */
  connected?: string | null;
  /** The destination this setup replaces. */
  replace?: string | null;
  rotate?: boolean;
}): string {
  const query = new URLSearchParams({ step: params.step });
  if (params.provider) query.set("provider", params.provider);
  if (params.connected) query.set("connected", params.connected);
  if (params.replace) query.set("replace", params.replace);
  if (params.rotate) query.set("rotate", "1");
  return `${SETUP_PATH}?${query.toString()}`;
}

/** The provider → start route kind, for the three that connect by a trip. */
export const OAUTH_KIND = {
  google_drive: "google",
  dropbox: "dropbox",
  onedrive: "microsoft",
} as const;

export function oauthStartHref(provider: keyof typeof OAUTH_KIND): string {
  return `/api/backup/oauth/${OAUTH_KIND[provider]}/start`;
}
