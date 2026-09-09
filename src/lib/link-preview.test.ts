import { describe, expect, it } from "vitest";
import {
  isLinkPreviewCrawler,
  linkPreviewDocument,
  linkPreviewResponse,
} from "./link-preview";

/**
 * The two halves of the chat bubble, on their own.
 *
 * Recognition is an allowlist, so what matters is both directions: the agents
 * that must be caught, and — much more importantly — the ones that must not
 * be, because a person mistaken for a crawler is served a dead end instead of
 * the group they were invited to.
 */

const PREVIEW: Parameters<typeof linkPreviewDocument>[0] = {
  url: "https://balancia.example/join/g/token",
  title: "Join Lisbon trip on Balancia",
  description: "Ada invites you to join Lisbon trip.",
  image: "https://balancia.example/join/og/coral/plane",
  imageAlt: "Lisbon trip on Balancia",
  imageSize: { width: 1200, height: 630 },
  locale: "en",
};

describe("recognising a link-preview crawler", () => {
  it.each([
    ["WhatsApp/2.23.20.0 A", "WhatsApp"],
    [
      "Mozilla/5.0 (compatible; facebookexternalhit/1.1; +http://www.facebook.com/externalhit_uatext.php)",
      "Messenger, and iMessage on macOS",
    ],
    ["TelegramBot (like TwitterBot)", "Telegram"],
    ["Twitterbot/1.0", "X"],
    ["Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)", "Slack"],
    [
      "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)",
      "Discord",
    ],
    ["LinkedInBot/1.0 (compatible; Mozilla/5.0)", "LinkedIn"],
    ["Mozilla/5.0 (compatible; Applebot/0.1)", "Apple"],
    ["Mozilla/5.0 (compatible; Bluesky Cardyb/1.1)", "Bluesky"],
  ])("catches %s (%s)", (agent) => {
    expect(isLinkPreviewCrawler(agent)).toBe(true);
  });

  it.each([
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari on a phone",
    ],
    [
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
      "Chrome on a phone",
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Chrome on a laptop",
    ],
    ["Balancia/1.4 (iOS)", "the Balancia app itself"],
  ])("leaves %s alone (%s)", (agent) => {
    expect(isLinkPreviewCrawler(agent)).toBe(false);
  });

  it("treats a request with no user agent as a person", () => {
    // The safe default: a redirect into the flow is what every request got
    // before this existed, and being wrong that way costs nobody their invite.
    expect(isLinkPreviewCrawler(null)).toBe(false);
    expect(isLinkPreviewCrawler("")).toBe(false);
  });
});

describe("the document a crawler is served", () => {
  const html = linkPreviewDocument(PREVIEW);

  it.each([
    ["og:type", "website"],
    ["og:site_name", "Balancia"],
    ["og:url", PREVIEW.url],
    ["og:title", PREVIEW.title],
    ["og:description", PREVIEW.description],
    ["og:image", PREVIEW.image],
    ["og:image:alt", PREVIEW.imageAlt],
    ["og:image:type", "image/png"],
    ["og:locale", "en"],
  ])("carries %s", (property, content) => {
    expect(html).toContain(
      `<meta property="${property}" content="${content}" />`,
    );
  });

  it.each([
    ["twitter:card", "summary_large_image"],
    ["twitter:title", PREVIEW.title],
    ["twitter:description", PREVIEW.description],
    ["twitter:image", PREVIEW.image],
  ])("carries %s, for the apps that read those instead", (name, content) => {
    expect(html).toContain(`<meta name="${name}" content="${content}" />`);
  });

  it("declares the image's size, so the bubble reserves the space", () => {
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).toContain('<meta property="og:image:height" content="630" />');
  });

  it("keeps a search engine out, as every other page does", () => {
    expect(html).toContain(
      '<meta name="robots" content="noindex, nofollow, noarchive" />',
    );
  });

  it("shows the group's name to whoever ends up reading the page itself", () => {
    expect(html).toContain(`<title>${PREVIEW.title}</title>`);
    expect(html).toContain(`<h1>${PREVIEW.title}</h1>`);
  });

  it("escapes a group name that would otherwise close the attribute", () => {
    const escaped = linkPreviewDocument({
      ...PREVIEW,
      title: '"Chez Ada" & <friends>',
    });
    expect(escaped).toContain(
      '<meta property="og:title" content="&quot;Chez Ada&quot; &amp; &lt;friends&gt;" />',
    );
    expect(escaped).not.toContain('content=""Chez Ada"');
  });

  it("names the locale on the document and in Open Graph's own spelling", () => {
    const french = linkPreviewDocument({ ...PREVIEW, locale: "fr-CH" });
    expect(french).toContain('<html lang="fr-CH">');
    expect(french).toContain('<meta property="og:locale" content="fr_CH" />');
  });

  it("is served as HTML that nothing in between may keep", async () => {
    const response = linkPreviewResponse(PREVIEW);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toContain(PREVIEW.title);
  });
});
