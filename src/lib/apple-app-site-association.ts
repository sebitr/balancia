/**
 * The Apple App Site Association document, served at
 * `/.well-known/apple-app-site-association`.
 *
 * Two separate things hang off this one file:
 *
 *  - **Universal Links.** iOS reads `applinks` when the app is installed and
 *    routes any *claimed* path to the app instead of Safari. The claim is
 *    app-wide and unconditional: a path listed here opens the app whether or
 *    not the app has a screen for it, so over-claiming turns a working web
 *    page into a dead end. Only the two link shapes Balancia actually mints
 *    are claimed.
 *  - **Passkeys and Sign in with Apple.** `webcredentials` is what associates
 *    the app with this domain's WebAuthn relying party, so a passkey created
 *    in the browser works in the app and the other way round. It has nothing
 *    to do with links; it costs three lines and the iOS client is blocked
 *    without it.
 *
 * Apple's fetcher is strict and, when it is unhappy, silent: there is no error
 * surface anywhere. It requires HTTPS with a valid certificate, HTTP 200 with
 * **no redirect**, `Content-Type: application/json`, and no authentication or
 * bot challenge. Nothing here may become dynamic or personalised.
 *
 * The path itself is why this is a rewrite rather than a route: Next's
 * file-system router does not pick up a dot-prefixed directory under `app/`,
 * so `app/.well-known/…/route.ts` 404s. `next.config.ts` rewrites the public
 * path onto the handler beside this file. A rewrite is server-internal and
 * keeps the URL — a *redirect* would be rejected by Apple.
 */

/**
 * `<App ID Prefix>.<bundle ID>`, matching `DEVELOPMENT_TEAM` and
 * `PRODUCT_BUNDLE_IDENTIFIER` in the iOS project.
 *
 * The prefix is normally the Team ID and is here, but the two can differ for
 * App IDs registered many years ago. A wrong prefix fails silently — no error
 * on the device, no error in the portal, links simply keep opening Safari —
 * so it is checked against the Apple Developer portal rather than assumed.
 *
 * Hard-coded rather than configurable on purpose. This identifies the
 * published Balancia app, not the deployment: a self-hosted instance serving
 * it is what lets the App Store build open *that* instance's invitations. A
 * fork shipping its own build changes this one constant.
 */
export const IOS_APP_ID = "C7F632ZUXF.net.balancia.balancia";

interface AppLinkComponent {
  readonly "/": string;
  readonly exclude?: true;
  readonly comment: string;
}

export interface AppleAppSiteAssociation {
  readonly applinks: {
    readonly details: readonly {
      readonly appIDs: readonly string[];
      readonly components: readonly AppLinkComponent[];
    }[];
  };
  readonly webcredentials: { readonly apps: readonly string[] };
}

/**
 * Matching is first-wins, so every exclusion has to precede the includes it
 * carves out of. `/join/*` is what makes the two `/join/…` exclusions
 * load-bearing rather than decorative: both are single segments under `/join`
 * and would otherwise be claimed.
 *
 * The rest are inert against today's includes — nothing under `/api` or the
 * auth pages can match `/join/*`. They are kept as a guardrail for the day the
 * claim is widened, which is the moment they stop being inert and start being
 * the reason sign-in still works.
 */
export const APPLE_APP_SITE_ASSOCIATION: AppleAppSiteAssociation = {
  applinks: {
    details: [
      {
        appIDs: [IOS_APP_ID],
        components: [
          // ── Exclusions, first: these win over everything below ──────────
          {
            "/": "/join/start",
            exclude: true,
            comment:
              "Where a group link lands once its token is spent. Reads the join cookie the browser was just given, which the app cannot see.",
          },
          {
            "/": "/join/error",
            exclude: true,
            comment:
              "The dead-link screen. Web-only; the app renders its own failure.",
          },
          {
            "/": "/api/*",
            exclude: true,
            comment:
              "The mobile API answers the app over HTTP. It must never be a link target.",
          },
          {
            "/": "/sign-in",
            exclude: true,
            comment: "Credential entry stays in the browser.",
          },
          {
            "/": "/register",
            exclude: true,
            comment: "Credential entry stays in the browser.",
          },
          {
            "/": "/register/*",
            exclude: true,
            comment: "Registration continues in the browser that started it.",
          },
          {
            "/": "/forgot-password",
            exclude: true,
            comment: "Password recovery stays in the browser.",
          },
          {
            "/": "/reset-password",
            exclude: true,
            comment:
              "Reached from a mailed token; the reset must finish where it was opened.",
          },
          {
            "/": "/verify-email",
            exclude: true,
            comment: "Mailed verification link. Sets a cookie and redirects.",
          },
          {
            "/": "/confirm-email",
            exclude: true,
            comment: "Mailed confirmation link. Sets a cookie and redirects.",
          },

          // ── Claims: the two shapes Balancia actually mints ──────────────
          {
            "/": "/join/g/*",
            comment:
              "Group-wide join link. Token is the last path segment; POST /api/groups/:groupId/join-link mints it.",
          },
          {
            "/": "/join/*",
            comment:
              "Per-person invitation. Token is the last path segment; POST /api/groups/:groupId/participants/:participantId/invitation mints it.",
          },
        ],
      },
    ],
  },
  webcredentials: { apps: [IOS_APP_ID] },
};
