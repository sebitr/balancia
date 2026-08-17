import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/locales";
import { renderAll, SAMPLE } from "./preview";
import { escapeHtml } from "./layout";
import { renderEmailChangeNoticeEmail } from "./templates";

/**
 * The transactional emails, against the design references.
 *
 * The fixtures under `tests/fixtures/emails` are the rendered output, checked
 * in so a change to the markup shows up as a reviewable diff rather than as a
 * silently different email. Three of the four English files are byte-identical
 * to the design handoff; the fourth differs only in its warning panel, which
 * points at password recovery rather than at a change-password screen this
 * application does not have.
 *
 * Regenerate with `pnpm email:render` after a deliberate change, and read the
 * diff before committing it.
 */

const FIXTURES = "tests/fixtures/emails";

function fixture(locale: string, name: string, extension: string): string {
  return readFileSync(`${FIXTURES}/${locale}/${name}.${extension}`, "utf8");
}

describe.each(LOCALES)("emails in %s", (locale) => {
  const rendered = renderAll(locale);

  it.each(Object.keys(rendered))("%s matches its fixture", (name) => {
    expect(rendered[name].html).toBe(fixture(locale, name, "html"));
    expect(
      `Subject: ${rendered[name].subject}\n\n${rendered[name].text}\n`,
    ).toBe(fixture(locale, name, "txt"));
  });

  it.each(Object.keys(rendered))("%s is written in that language", (name) => {
    expect(rendered[name].html).toContain(`<html lang="${locale}"`);
  });

  it.each(Object.keys(rendered))("%s deliverability rules hold", (name) => {
    const html = rendered[name].html;

    // Nothing that needs fetching, and nothing that can run. An email client
    // will block or strip all three, and several will penalise the message.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/@font-face|fonts\.googleapis/i);

    // The `<head>` block may carry only media queries and the link colour;
    // everything that positions or colours an element is inlined on it,
    // because several clients drop `<head>` styles outright.
    const head = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? "";
    expect(head).toContain("@media only screen and (max-width:620px)");
    expect(head).not.toMatch(/background:#(?!.*\}\s*$)/);

    // Outlook's Word engine needs every text element pinned and every table
    // and cell given a width, or it invents both.
    for (const paragraph of html.match(/<p[ >][^>]*>/g) ?? []) {
      expect(paragraph).toContain("mso-line-height-rule:exactly");
    }
    // …except the three cells that are meant to shrink to their contents, all
    // of which the design references leave unsized the same way: the one that
    // centres the card inside a table already at width="100%", the wordmark
    // beside the fixed-width dot, and the button, which is exactly as wide as
    // its padded label.
    const shrinkToFit = [
      /^<td align="center" style="padding:32px 16px">$/,
      /^<td valign="middle" style="font-family:Arial[^>]*font-weight:bold/,
      /^<td bgcolor="#F97361" align="center"/,
    ];
    const widthless = (html.match(/<td[ >][^>]*>/g) ?? []).filter(
      (cell) => !/width[:=]/.test(cell),
    );
    for (const cell of widthless) {
      expect(
        shrinkToFit.some((allowed) => allowed.test(cell)),
        `unsized cell: ${cell}`,
      ).toBe(true);
    }

    // Gmail clips a message over roughly 100KB, which would cut the button off.
    expect(Buffer.byteLength(html, "utf8")).toBeLessThan(40_000);
  });

  it("puts every link in the plain-text body too", () => {
    for (const [name, email] of Object.entries(rendered)) {
      const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map(
        (match) => match[1],
      );
      expect(hrefs.length, name).toBeGreaterThan(0);
      for (const href of new Set(hrefs)) {
        expect(email.text, `${name} → ${href}`).toContain(href);
      }
    }
  });

  it("carries the token exactly once as a button and once as text", () => {
    const reset = rendered["reset-password-email"].html;
    const occurrences = reset.split(SAMPLE.resetToken).length - 1;
    // Twice in the button (href) and twice in the fallback (href and label).
    expect(occurrences).toBe(3);
  });

  it("leaves no message key unresolved", () => {
    for (const [name, email] of Object.entries(rendered)) {
      expect(email.html, name).not.toMatch(/emails\.\w+\.\w+/);
      expect(email.subject, name).not.toMatch(/^emails\./);
    }
  });
});

describe("the change-of-address notice", () => {
  it("emphasises the requested address inside the sentence", () => {
    const { html } = renderEmailChangeNoticeEmail({
      locale: "en",
      newEmail: "new@example.test",
      recoverUrl: "https://balancia.test/forgot-password",
    });
    expect(html).toContain(
      '<strong style="font-weight:bold">new@example.test</strong>',
    );
  });

  it("escapes an address rather than letting it become markup", () => {
    // Nothing reaches this having skipped `z.email()`, which cannot pass a
    // bracket — but the escaping is what makes that a defence rather than a
    // dependency on the caller.
    const hostile = '"><script>alert(1)</script>';
    const { html } = renderEmailChangeNoticeEmail({
      locale: "en",
      newEmail: hostile,
      recoverUrl: "https://balancia.test/forgot-password",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain(escapeHtml(hostile));
  });

  it("offers recovery instead of a button, and points it where told", () => {
    const { html } = renderEmailChangeNoticeEmail({
      locale: "en",
      newEmail: "new@example.test",
      recoverUrl: "https://balancia.test/forgot-password",
    });
    // No primary action: from the old address there is nothing to confirm.
    expect(html).not.toContain('bgcolor="#F97361"');
    expect(html).toContain('href="https://balancia.test/forgot-password"');
    // The destructive treatment is a tint, never a solid fill.
    expect(html).toContain("background:#FAEDEA");
  });
});

describe("escaping", () => {
  it("leaves the apostrophe alone and escapes the rest", () => {
    expect(escapeHtml("didn't")).toBe("didn't");
    expect(escapeHtml('a & b < c > d "e"')).toBe(
      "a &amp; b &lt; c &gt; d &quot;e&quot;",
    );
  });
});
