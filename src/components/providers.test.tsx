// @vitest-environment node
//
// Node rather than jsdom on purpose: next-themes writes the nonce only where
// `window` is undefined, which is the server render this test is about.
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Providers } from "./providers";

/**
 * The theme's pre-paint script has to carry the response's policy nonce.
 *
 * `proxy.ts` sets a strict Content Security Policy that admits an inline
 * script only when it carries the nonce of the response it came in. next-themes
 * injects one inline script to apply the stored theme before hydration; if
 * that script does not carry the nonce the browser refuses it, logs a
 * violation on every page, and a reader who chose dark sees the light ground
 * until React has loaded. This is what pinned that down.
 *
 * Rendered on the server on purpose: the script is a server-render concern,
 * and next-themes only writes the attribute there — on the client it is
 * already too late for a pre-paint script to matter.
 */
describe("Providers", () => {
  it("hands the policy nonce to the theme's pre-paint script", () => {
    const html = renderToStaticMarkup(
      <Providers nonce="nonce-under-test">
        <span>child</span>
      </Providers>,
    );

    const scripts = html.match(/<script[^>]*>/g) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    for (const tag of scripts) {
      expect(tag).toContain('nonce="nonce-under-test"');
    }
  });
});
