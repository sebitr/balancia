import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/locales";
import { renderAll, SAMPLE } from "./preview";
import { escapeHtml } from "./layout";
import { fonts, MARK, palette } from "./tokens";
import { renderEmailChangeNoticeEmail } from "./templates";

/**
 * The transactional emails, against their rendered fixtures.
 *
 * The files under `tests/fixtures/emails` are the rendered output, checked in
 * so a change to the markup shows up as a reviewable diff rather than as a
 * silently different email. They follow the design handoff's structure,
 * spacing and copy; the colours come from the theme tokens instead of the
 * handoff's hand-tuned hex, which `tokens.test.ts` is what holds in place.
 *
 * Regenerate with `pnpm email:render` after a deliberate change, and read the
 * diff before committing it.
 */

const FIXTURES = "tests/fixtures/emails";

/** The two that end in six digits rather than a link. */
const CODE_EMAILS = ["verify-code-email", "sign-in-code-email"];

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

    // Nothing that can run, and nothing fetched from anywhere but this
    // instance. A client will block or strip these, and several will penalise
    // the message for carrying them.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<link\s/i);
    expect(html).not.toMatch(/@font-face|fonts\.googleapis/i);

    // Exactly one image: the header mark. It is decorative — the wordmark
    // beside it is live text — so it carries an empty alt, and it is sized in
    // the markup as well as the style so a blocking client reserves the right
    // space instead of collapsing the header.
    const images = html.match(/<img[^>]*>/g) ?? [];
    expect(images).toHaveLength(1);
    expect(images[0]).toContain(`src="https://balancia.app${MARK.path}"`);
    expect(images[0]).toContain('alt=""');
    expect(images[0]).toContain(`width="${MARK.width}"`);
    expect(images[0]).toContain(`height="${MARK.height}"`);
    // Blocked images must not take the sender's name down with them.
    expect(html).toContain(">Balancia</td>");

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
    // …except the three cells that are meant to shrink to their contents: the
    // one that centres the card inside a table already at width="100%", the
    // wordmark beside the fixed-width mark, and the button, which is exactly
    // as wide as its padded label.
    const shrinkToFit = [
      /^<td align="center" style="padding:32px 16px">$/,
      /^<td valign="middle" style="font-family:Arial[^>]*font-weight:bold/,
      new RegExp(`^<td bgcolor="\\${palette.primary}" align="center"`),
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
      if (CODE_EMAILS.includes(name)) continue;
      const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map(
        (match) => match[1],
      );
      expect(hrefs.length, name).toBeGreaterThan(0);
      for (const href of new Set(hrefs)) {
        expect(email.text, `${name} → ${href}`).toContain(href);
      }
    }
  });

  it.each(CODE_EMAILS)("%s links nowhere at all", (name) => {
    // An email that asks for a code and also offers something to click is the
    // habit a phishing mail relies on, so this is a rule and not an accident.
    expect(rendered[name].html).not.toMatch(/href=/);
    expect(rendered[name].text).not.toMatch(/https?:/);
  });

  it.each(CODE_EMAILS)("%s offers the code as one selection", (name) => {
    const html = rendered[name].html;
    // No client will run a copy button, so `user-select:all` is the whole
    // affordance: one tap or click takes the six figures and nothing else.
    const code = /<p class="code"[^>]*>(\d+)<\/p>/.exec(html);
    expect(code?.[1], "the code is one text node, not six").toBe(SAMPLE.code);
    expect(code?.[0]).toContain("user-select:all");
    expect(code?.[0]).toContain("-webkit-user-select:all");
  });

  it.each(CODE_EMAILS)("%s sets the figures in a lining face", (name) => {
    const code = /<p class="code"[^>]*>\d+<\/p>/.exec(rendered[name].html)?.[0];
    // Georgia is the set's display face and it sets old-style figures, which
    // put six digits on three different baselines. Whatever else this line
    // becomes, it does not go back to a face chosen for prose.
    expect(code).toContain(`font-family:${fonts.figures}`);
    expect(code).not.toContain("Georgia");
  });

  it.each(CODE_EMAILS)("%s keeps the word next to the figures", (name) => {
    const { html, text, subject } = rendered[name];
    // iOS and Android offer a one-time code to the keyboard when they find one
    // beside a word like "code". The subject leads with it, the panel label
    // sits immediately above the digits, and the plain-text part names it in
    // the first sentence — three chances at the same heuristic.
    const code = new RegExp(`\\b${SAMPLE.code}\\b`);
    expect(subject).toMatch(code);
    expect(text.split("\n")[0]).toMatch(code);
    const panel = /padding:18px 20px">\s*<p[^>]*>([^<]*)<\/p>/.exec(html);
    expect(panel?.[1] ?? "").toMatch(/code/i);

    // …and nothing else in the message may look like a candidate code. A
    // closing line that read "expires in 10 minutes" put a second number
    // beside the same keyword, which is how the wrong one gets offered.
    const others = [...text.matchAll(/\d+/g)]
      .map((match) => match[0])
      .filter((digits) => digits !== SAMPLE.code);
    expect(others, `competing numbers in ${name}`).toEqual([]);
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
      origin: "https://balancia.test",
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
      origin: "https://balancia.test",
      newEmail: hostile,
      recoverUrl: "https://balancia.test/forgot-password",
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain(escapeHtml(hostile));
  });

  it("offers recovery instead of a button, and points it where told", () => {
    const { html } = renderEmailChangeNoticeEmail({
      locale: "en",
      origin: "https://balancia.test",
      newEmail: "new@example.test",
      recoverUrl: "https://balancia.test/forgot-password",
    });
    // No primary action: from the old address there is nothing to confirm.
    expect(html).not.toContain(`bgcolor="${palette.primary}"`);
    expect(html).toContain('href="https://balancia.test/forgot-password"');
    // The destructive treatment is a tint, never a solid fill.
    expect(html).toContain(`background:${palette.destructiveTint}`);
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
