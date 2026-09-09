/**
 * What a chat app is told about a link before anybody taps it.
 *
 * A join link pasted into WhatsApp renders as a naked URL: five people are
 * asked to tap an unexplained address on a domain they have never heard of,
 * which is the exact shape of every scam they have been warned about. The
 * whole fix is four meta tags — a title, a line of prose, an image and the
 * site's name — read by a crawler that fetches the URL the moment it is
 * pasted, seconds before a human sees the bubble.
 *
 * Both join routes are redirects, and a redirect carries no tags. So they
 * answer a crawler with a document instead, and this module is the two halves
 * of that: recognising one, and writing the document.
 *
 * Neither half touches the database or the session, which is what keeps this
 * testable as a pure function and out of the way of the security notes in the
 * routes themselves.
 */

/**
 * The user agents that fetch a URL to draw a bubble around it.
 *
 * An allowlist rather than a heuristic. Anything not named here gets the
 * behaviour it has always had — a redirect into the join flow — so the cost
 * of an omission is the naked URL we have today, and never a person sent to a
 * preview page instead of the group they were invited to.
 *
 * Matched as lowercased substrings because every one of these carries a
 * version after its name, and some carry a whole browser string around it.
 *
 * Two known gaps, both unfixable from here and neither a regression:
 * iMessage on iOS fetches with a stock Safari agent, and so does Signal on
 * some builds — they are indistinguishable from the person holding the phone.
 * Signal on Android identifies as WhatsApp on purpose, so it is covered by
 * the first entry without being named.
 */
const PREVIEW_AGENTS: readonly string[] = [
  "whatsapp",
  // Messenger, Instagram, Facebook, and iMessage on macOS.
  "facebookexternalhit",
  "facebookcatalog",
  "facebot",
  "telegrambot",
  "twitterbot",
  // Also "Slackbot-LinkExpanding", which is the one that draws the unfurl.
  "slackbot",
  "slack-imgproxy",
  "discordbot",
  "linkedinbot",
  "skypeuripreview",
  "redditbot",
  "applebot",
  "viber",
  "bluesky cardyb",
  "mastodon",
  "embedly",
  "iframely",
];

export function isLinkPreviewCrawler(
  userAgent: string | null | undefined,
): boolean {
  if (!userAgent) return false;
  const agent = userAgent.toLowerCase();
  return PREVIEW_AGENTS.some((name) => agent.includes(name));
}

export interface LinkPreview {
  /** The canonical address of the link, for `og:url`. */
  readonly url: string;
  readonly title: string;
  readonly description: string;
  /** Absolute — a crawler resolves nothing against the document. */
  readonly image: string;
  readonly imageAlt: string;
  readonly imageSize: { readonly width: number; readonly height: number };
  /** BCP 47, for `<html lang>`; `og:locale` wants it underscored. */
  readonly locale: string;
}

/** `"` and `&` matter inside an attribute; the rest are cheap insurance. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The document a crawler is answered with.
 *
 * Written out rather than rendered through the app's layout, because none of
 * the layout applies: no fonts, no stylesheet, no scripts, nothing to
 * hydrate — a crawler reads `<head>` and closes the connection. What is in
 * `<body>` is there for the rare human whose browser identifies as one of the
 * agents above, so that they see the group's name rather than a blank page.
 *
 * `robots` repeats what the app's layout says everywhere else: none of this
 * is for a search engine, and a URL holding a live token least of all.
 */
export function linkPreviewDocument(preview: LinkPreview): string {
  const meta: readonly (readonly [string, string])[] = [
    ["og:type", "website"],
    ["og:site_name", "Balancia"],
    ["og:url", preview.url],
    ["og:title", preview.title],
    ["og:description", preview.description],
    ["og:image", preview.image],
    ["og:image:alt", preview.imageAlt],
    ["og:image:type", "image/png"],
    ["og:image:width", String(preview.imageSize.width)],
    ["og:image:height", String(preview.imageSize.height)],
    ["og:locale", preview.locale.replace("-", "_")],
  ];
  const named: readonly (readonly [string, string])[] = [
    ["robots", "noindex, nofollow, noarchive"],
    ["description", preview.description],
    ["twitter:card", "summary_large_image"],
    ["twitter:title", preview.title],
    ["twitter:description", preview.description],
    ["twitter:image", preview.image],
    ["twitter:image:alt", preview.imageAlt],
  ];

  const tags = [
    ...meta.map(
      ([property, content]) =>
        `<meta property="${property}" content="${escapeHtml(content)}" />`,
    ),
    ...named.map(
      ([name, content]) =>
        `<meta name="${name}" content="${escapeHtml(content)}" />`,
    ),
  ].join("\n    ");

  return `<!doctype html>
<html lang="${escapeHtml(preview.locale)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(preview.title)}</title>
    ${tags}
  </head>
  <body>
    <h1>${escapeHtml(preview.title)}</h1>
    <p>${escapeHtml(preview.description)}</p>
  </body>
</html>
`;
}

/**
 * The document as a response.
 *
 * `no-store` because the body carries a group's name and is keyed by a live
 * token. The crawler that asked will cache it wherever it likes — that is
 * what a preview is — but nothing in between is invited to keep a copy.
 */
export function linkPreviewResponse(preview: LinkPreview): Response {
  return new Response(linkPreviewDocument(preview), {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
