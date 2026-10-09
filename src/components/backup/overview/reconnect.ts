import { PROVIDERS, type BackupProvider } from "@/modules/backup/providers";

/**
 * Where a destination that stopped working is reconnected.
 *
 * The three providers connected by a trip to the provider are re-authorised by
 * the same route that first connected them, told which destination to refresh.
 * That route is reached by a plain anchor, never `next/link`: a link prefetches,
 * and a prefetch would start the flow; nor a form or a fetch, because the
 * page's `form-action 'self'` blocks the redirect to the provider.
 *
 * The providers connected by typing details have nothing to redirect to, so the
 * person is sent back through the wizard's connect step, which replaces the old
 * destination once the new one works.
 *
 * So is an account whose *app* was refused. Going back through the same app
 * would be refused the same way; what is wrong is the client ID or secret, or
 * the app itself, and only the wizard can ask for new ones.
 */

/** The route's name for each OAuth provider, which is not always the provider's. */
const OAUTH_ROUTE: Readonly<Partial<Record<BackupProvider, string>>> = {
  google_drive: "google",
  dropbox: "dropbox",
  onedrive: "microsoft",
};

export type ReconnectTarget =
  | { readonly kind: "oauth"; readonly href: string }
  | { readonly kind: "wizard"; readonly href: string };

export function reconnectTarget(
  provider: BackupProvider,
  destinationId: string,
  options: { appRefused?: boolean } = {},
): ReconnectTarget {
  const route = OAUTH_ROUTE[provider];
  if (PROVIDERS[provider].kind === "oauth" && route && !options.appRefused) {
    return {
      kind: "oauth",
      href: `/api/backup/oauth/${route}/start?reconnect=${encodeURIComponent(destinationId)}`,
    };
  }
  return {
    kind: "wizard",
    href: `/settings/backup/setup?step=connect&provider=${encodeURIComponent(provider)}&replace=${encodeURIComponent(destinationId)}`,
  };
}
