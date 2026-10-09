import { describe, expect, it } from "vitest";
import { handoffPage } from "./handoff";

const LOCATION =
  "https://claude.ai/api/mcp/auth_callback?code=abc&state=x%26y&iss=https%3A%2F%2Fbalancia.example";

function page(overrides: Partial<Parameters<typeof handoffPage>[0]> = {}) {
  return handoffPage({
    location: LOCATION,
    language: "en",
    title: "Returning to claude.ai…",
    hint: "If nothing happens, press Continue.",
    continueLabel: "Continue",
    ...overrides,
  });
}

describe("the page between Allow and the assistant", () => {
  it("sends the browser onward at once, and gives it a link for when it will not go", () => {
    const html = page();

    expect(html).toContain(
      '<meta http-equiv="refresh" content="0;url=https://claude.ai/api/mcp/auth_callback?code=abc&amp;state=x%26y&amp;iss=https%3A%2F%2Fbalancia.example">',
    );
    expect(html).toContain(
      '<a href="https://claude.ai/api/mcp/auth_callback?code=abc&amp;state=x%26y&amp;iss=https%3A%2F%2Fbalancia.example">Continue</a>',
    );
  });

  it("is not a redirect, so a form-action policy has nothing to refuse", () => {
    // The whole reason this page exists. A script would be refused by the
    // site's CSP too, so the page must not rely on one.
    expect(page()).not.toMatch(/<script/i);
  });

  it("does not let the address or the words break out of the page", () => {
    const html = page({
      location: 'https://example.com/cb?x="><script>alert(1)</script>',
      title: "<img src=x onerror=alert(1)>",
      hint: "a & b",
      continueLabel: "'go'",
    });

    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("a &amp; b");
    expect(html).toContain("&#39;go&#39;");
  });

  it("asks that nothing be remembered or passed on", () => {
    const html = page();

    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain('<meta name="robots" content="noindex">');
  });

  it("speaks the reader's language to a screen reader", () => {
    expect(page({ language: "fr" })).toContain('<html lang="fr">');
  });

  it("carries a native scheme as it is", () => {
    const html = page({
      location: "cursor://anysphere.cursor-retrieval/cb?code=abc",
    });
    expect(html).toContain(
      'href="cursor://anysphere.cursor-retrieval/cb?code=abc"',
    );
  });
});
