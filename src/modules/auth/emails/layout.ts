import { fonts, MARK, palette } from "./tokens";

/**
 * The shared skeleton every transactional email is assembled from.
 *
 * This is deliberately markup from 1999, and none of it is an accident:
 *
 *  - Nested `<table role="presentation">` for all layout. No flex, no grid, no
 *    floats. The Outlook Word engine understands tables and little else.
 *  - Every style inlined on the element it styles. Several clients drop the
 *    `<style>` block entirely, so the `<head>` carries only media queries and
 *    the link colour — things the email can survive losing.
 *  - `mso-line-height-rule:exactly` on every text element and an explicit
 *    `width` on every table and cell, again for Outlook.
 *  - Buttons are a padded `<td bgcolor>` with an `<a display:block>` filling
 *    it. Never an `<img>`, which image blocking would erase, and never a
 *    `<button>`, which does nothing in a mail client.
 *  - No JavaScript, no external stylesheets, no web fonts. The single image is
 *    the header mark, which is decorative and beside live text, so a client
 *    with images off loses a glyph rather than the sender's name.
 *
 * Rewriting any of that into something modern breaks the email in the clients
 * most likely to be reading it. The rendered output is checked against the
 * fixtures in `tests/fixtures/emails`, which is what stops it drifting.
 */

/**
 * Escapes text for interpolation into markup or an attribute.
 *
 * The apostrophe is deliberately left alone. Every attribute this module emits
 * is double-quoted, so `'` cannot close one, and escaping it would turn every
 * "didn't" and every "n'a pas" in the copy into `&#39;` — correct, unreadable
 * in the source, and a needless difference from the design references.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The card is 600px; its body cells are 536px inside 32px of padding. */
const CARD_WIDTH = 600;
const PANEL_WIDTH = 536;

const CELL_SIDES =
  `background:${palette.surface};` +
  `border-left:1px solid ${palette.ground};` +
  `border-right:1px solid ${palette.ground}`;

const CELL_LAST =
  `${CELL_SIDES};border-bottom:1px solid ${palette.ground};` +
  `border-radius:0 0 14px 14px`;

/**
 * The responsive classes an email opts into. Only the ones it uses are
 * emitted, so the `<head>` never carries a rule for an element that is not
 * there.
 */
export type ResponsiveClass = "fallback" | "panel" | "display";

const RESPONSIVE_RULES: Record<ResponsiveClass, string> = {
  fallback: "    .fallback { width:100% !important; }",
  panel: "    .panel { width:100% !important; }",
  display:
    "    .display { font-size:27px !important; line-height:33px !important; }",
};

/** One body cell of the card, holding already-indented content. */
export function cell(
  padding: string,
  content: string,
  options: { last?: boolean } = {},
): string {
  const style = `width:${CARD_WIDTH}px;${options.last ? CELL_LAST : CELL_SIDES};padding:${padding}`;
  return [
    `        <tr>`,
    `          <td width="${CARD_WIDTH}" class="pad" style="${style}">`,
    content,
    `          </td>`,
    `        </tr>`,
  ].join("\n");
}

/** A paragraph, at one of the sizes in the type scale. */
export function paragraph(
  text: string,
  options: {
    size: number;
    leading: number;
    color: string;
    font?: string;
    weight?: "bold";
    letterSpacing?: string;
    className?: string;
    marginBottom?: number;
    /** See `codePanel`. Only the code uses this. */
    selectable?: boolean;
  },
): string {
  const style = [
    `margin:${options.marginBottom ? `0 0 ${options.marginBottom}px` : "0"}`,
    `font-family:${options.font ?? fonts.sans}`,
    `font-size:${options.size}px`,
    ...(options.weight ? [`font-weight:${options.weight}`] : []),
    `line-height:${options.leading}px`,
    `mso-line-height-rule:exactly`,
    ...(options.letterSpacing
      ? [`letter-spacing:${options.letterSpacing}`]
      : []),
    `color:${options.color}`,
    // Vendor-prefixed forms first: WebKit and Gecko shipped `all` behind a
    // prefix and several mail clients are still on those engines.
    ...(options.selectable
      ? [
          `-webkit-user-select:all`,
          `-moz-user-select:all`,
          `-ms-user-select:all`,
          `user-select:all`,
        ]
      : []),
  ].join(";");
  const classAttribute = options.className
    ? ` class="${options.className}"`
    : "";
  return `            <p${classAttribute} style="${style}">${text}</p>`;
}

/**
 * The primary action.
 *
 * Coral fill with plum text: the design system pairs `--primary` with
 * `--primary-foreground`, and that is plum, not white.
 */
export function button(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  const linkStyle =
    `display:block;padding:14px 28px;font-family:${fonts.sans};font-size:16px;` +
    `font-weight:bold;line-height:20px;mso-line-height-rule:exactly;` +
    `color:${palette.primaryInk};text-decoration:none;border-radius:12px`;
  return [
    `            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `              <td bgcolor="${palette.primary}" align="center" style="background:${palette.primary};border-radius:12px">`,
    `                <a href="${safeHref}" style="${linkStyle}">${escapeHtml(label)}</a>`,
    `              </td>`,
    `            </tr></table>`,
  ].join("\n");
}

/**
 * The same URL again, as text.
 *
 * A button is a link a client may rewrite, strip or fail to render; this is
 * the copy the reader can always get at. `word-break:break-all` is what stops
 * a 43-character token pushing the card wider than the viewport.
 */
export function linkFallback(href: string, label: string): string {
  const safeHref = escapeHtml(href);
  const urlStyle =
    `font-family:${fonts.mono};font-size:12px;line-height:18px;` +
    `mso-line-height-rule:exactly;color:${palette.link};` +
    `text-decoration:none;word-break:break-all`;
  return [
    `            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${PANEL_WIDTH}" class="fallback" style="width:${PANEL_WIDTH}px;background:${palette.wrapper};border-radius:10px;border-collapse:separate"><tr>`,
    `              <td width="${PANEL_WIDTH}" style="width:${PANEL_WIDTH}px;padding:14px 16px">`,
    `                <p style="margin:0 0 6px;font-family:${fonts.sans};font-size:12px;line-height:16px;mso-line-height-rule:exactly;color:${palette.mutedInk}">${escapeHtml(label)}</p>`,
    `                <a href="${safeHref}" style="${urlStyle}">${safeHref}</a>`,
    `              </td>`,
    `            </tr></table>`,
  ].join("\n");
}

/**
 * The code, in a panel a single tap or click selects whole.
 *
 * There is no copy button here and there cannot be one: a mail client runs no
 * JavaScript, so nothing in a message can reach the clipboard. `user-select:all`
 * is the closest an email gets — one tap on a phone, one click on a desktop,
 * and the whole code is the selection, so the reader presses copy instead of
 * dragging a caret across six characters they are trying not to misread.
 *
 * Where a client strips the property the panel is still just the code on a
 * tinted ground, selected by hand as before; nothing depends on it landing.
 *
 * The label is inside the panel rather than above it for a second reason. iOS
 * and Android offer a one-time code to the keyboard when they find one near a
 * word like "code", and the sentence that carried that word used to sit a
 * paragraph away. Now it sits immediately before the digits.
 *
 * Letter-spacing is a rendering, not a character: what the reader copies is the
 * six figures and nothing between them.
 */
export function codePanel(label: string, codeParagraph: string): string {
  return [
    `            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${PANEL_WIDTH}" class="panel" style="width:${PANEL_WIDTH}px;background:${palette.wrapper};border-radius:10px;border-collapse:separate"><tr>`,
    `              <td width="${PANEL_WIDTH}" style="width:${PANEL_WIDTH}px;padding:18px 20px">`,
    `                <p style="margin:0 0 6px;font-family:${fonts.sans};font-size:12px;line-height:16px;mso-line-height-rule:exactly;color:${palette.mutedInk}">${escapeHtml(label)}</p>`,
    // `paragraph` indents for a card cell; inside the panel it sits deeper.
    `                ${codeParagraph.trimStart()}`,
    `              </td>`,
    `            </tr></table>`,
  ].join("\n");
}

/**
 * The defensive panel on the change-of-address notice.
 *
 * The design system's destructive treatment is a tint with destructive-coloured
 * text, never a solid fill — a red button here would read as the thing to do,
 * and the thing to do is usually nothing.
 */
export function warningPanel(content: {
  title: string;
  body: string;
  href: string;
  linkLabel: string;
}): string {
  const linkStyle =
    `font-family:${fonts.sans};font-size:14px;font-weight:bold;line-height:20px;` +
    `mso-line-height-rule:exactly;color:${palette.destructive};text-decoration:underline`;
  return [
    `            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${PANEL_WIDTH}" class="panel" style="width:${PANEL_WIDTH}px;background:${palette.destructiveTint};border-radius:12px;border-collapse:separate"><tr>`,
    `              <td width="${PANEL_WIDTH}" style="width:${PANEL_WIDTH}px;padding:18px 20px">`,
    `                <p style="margin:0 0 6px;font-family:${fonts.sans};font-size:14px;font-weight:bold;line-height:20px;mso-line-height-rule:exactly;color:${palette.destructive}">${escapeHtml(content.title)}</p>`,
    `                <p style="margin:0 0 14px;font-family:${fonts.sans};font-size:14px;line-height:21px;mso-line-height-rule:exactly;color:${palette.destructiveInk}">${escapeHtml(content.body)}</p>`,
    `                <a href="${escapeHtml(content.href)}" style="${linkStyle}">${escapeHtml(content.linkLabel)}</a>`,
    `              </td>`,
    `            </tr></table>`,
  ].join("\n");
}

/** The hairline above the closing note. */
export function divider(): string {
  return `            <div style="height:1px;background:${palette.ground};font-size:0;line-height:0">&nbsp;</div>`;
}

/**
 * The plum bar: the mark, then the wordmark.
 *
 * The wordmark stays live text rather than joining the image. It is the half
 * that carries the name, so a client with images off — which is most of them,
 * on first open — still shows a branded header rather than an empty bar, and
 * the text scales with the reader's own settings. The mark is therefore purely
 * decorative and takes an empty `alt`; giving it `alt="Balancia"` would make a
 * screen reader say the name twice.
 *
 * `display:block` on the image is what stops clients that treat it as inline
 * text adding a descender's worth of space under it.
 */
function headerBar(origin: string): string {
  const wordmarkStyle =
    `font-family:${fonts.sans};font-size:19px;font-weight:bold;` +
    `letter-spacing:-0.3px;color:${palette.wrapper};` +
    `mso-line-height-rule:exactly;line-height:22px`;
  const markSrc = escapeHtml(`${origin}${MARK.path}`);
  return [
    `        <tr>`,
    `          <td width="${CARD_WIDTH}" class="pad" style="width:${CARD_WIDTH}px;background:${palette.ink};padding:22px 32px;border-radius:14px 14px 0 0">`,
    `            <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `              <td width="${MARK.width}" style="width:${MARK.width}px;padding-right:10px" valign="middle"><img src="${markSrc}" width="${MARK.width}" height="${MARK.height}" alt="" style="display:block;width:${MARK.width}px;height:${MARK.height}px;border:0;outline:none;text-decoration:none"></td>`,
    `              <td valign="middle" style="${wordmarkStyle}">Balancia</td>`,
    `            </tr></table>`,
    `          </td>`,
    `        </tr>`,
  ].join("\n");
}

export interface DocumentOptions {
  readonly lang: string;
  /** The instance's public origin, which the header mark is served from. */
  readonly origin: string;
  readonly title: string;
  /** The ~85 characters a client shows next to the subject in the list. */
  readonly preheader: string;
  readonly linkColor: string;
  readonly responsive: readonly ResponsiveClass[];
  /** Body cells, already built by `cell`. */
  readonly rows: readonly string[];
}

export function emailDocument(options: DocumentOptions): string {
  const mediaRules = options.responsive.map((name) => RESPONSIVE_RULES[name]);
  const preheaderStyle =
    `display:none;font-size:1px;color:${palette.ground};line-height:1px;` +
    `max-height:0;max-width:0;opacity:0;overflow:hidden`;

  return `<!doctype html>
<html lang="${options.lang}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="x-ua-compatible" content="ie=edge">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(options.title)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  body { margin:0; padding:0; width:100% !important; }
  img { border:0; outline:none; text-decoration:none; }
  a { color:${options.linkColor}; }
  @media only screen and (max-width:620px) {
    .wrap { width:100% !important; max-width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
${mediaRules.join("\n")}
  }
</style>
</head>
<body style="margin:0;padding:0;background:${palette.ground}">
<span style="${preheaderStyle}">${escapeHtml(options.preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${palette.ground};border-collapse:collapse">
  <tr>
    <td align="center" style="padding:32px 16px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${CARD_WIDTH}" class="wrap" style="width:${CARD_WIDTH}px;max-width:${CARD_WIDTH}px;background:${palette.wrapper};border-collapse:collapse">
${headerBar(options.origin)}
${options.rows.join("\n")}
      </table>
    </td>
  </tr>
</table>
</body>
</html>
`;
}
