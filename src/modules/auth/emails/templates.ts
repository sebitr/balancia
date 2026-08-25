import { emailTranslator, resolveLocale } from "@/i18n/emails";
import { fonts, palette } from "./tokens";
import {
  button,
  cell,
  codePanel,
  divider,
  emailDocument,
  escapeHtml,
  linkFallback,
  paragraph,
  warningPanel,
  type ResponsiveClass,
} from "./layout";

/**
 * The six transactional emails, in HTML and in plain text.
 *
 * Every one is sent in the recipient's language, so nothing here is a literal
 * string of copy: the catalogues under `emails.*` are the source, and the
 * layout module is the source of the markup. What is left in this file is the
 * arrangement — which paragraph at which size, in which order, with how much
 * space above it — which is the part the design specifies per email.
 *
 * Both bodies are always produced. A client that refuses HTML, or a reader who
 * has turned it off, gets the same information in the same order with the URL
 * on its own line; neither version is a summary of the other.
 */

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/** The type scale, so a size is chosen from the set rather than invented. */
const type = {
  display: { size: 32, leading: 38, color: palette.ink, font: fonts.serif },
  lead: { size: 19, leading: 28, color: palette.ink },
  bodyLarge: { size: 17, leading: 26, color: palette.ink },
  secondary: { size: 15, leading: 22, color: palette.mutedInk },
  small: { size: 14, leading: 21, color: palette.mutedInk },
  closing: { size: 13, leading: 20, color: palette.mutedInk },
} as const;

/**
 * The three emails that end in a link the reader has to open.
 *
 * They differ in their copy and in a few pixels of padding, and in nothing
 * else, so they are one function rather than three near-copies. The welcome
 * email leads with the set's one serif line, which is what `display` carries.
 */
function linkEmail(options: {
  locale: string | null | undefined;
  origin: string;
  url: string;
  /** The `<title>`, which is not the subject line: shorter, and rarely seen. */
  title: string;
  preheader: string;
  display?: string;
  lead: string;
  leadSize: typeof type.lead | typeof type.bodyLarge;
  /** Absent on the welcome email, which says everything in one line. */
  sub?: { text: string; leading: number };
  buttonLabel: string;
  fallbackLabel: string;
  closing: string;
  /** The design gives each email its own rhythm; these are not shared. */
  spacing: { lead: string; sub?: string; button: string };
}): string {
  const rows: string[] = [];
  const responsive: ResponsiveClass[] = ["fallback"];

  if (options.display) {
    responsive.push("display");
    rows.push(
      cell(
        options.spacing.lead,
        paragraph(escapeHtml(options.display), {
          ...type.display,
          letterSpacing: "-0.5px",
          className: "display",
        }),
      ),
    );
    rows.push(
      cell(
        "20px 32px 0",
        paragraph(escapeHtml(options.lead), options.leadSize),
      ),
    );
  } else {
    rows.push(
      cell(
        options.spacing.lead,
        paragraph(escapeHtml(options.lead), options.leadSize),
      ),
    );
  }

  if (options.sub && options.spacing.sub) {
    rows.push(
      cell(
        options.spacing.sub,
        paragraph(escapeHtml(options.sub.text), {
          ...type.secondary,
          leading: options.sub.leading,
        }),
      ),
    );
  }

  rows.push(
    cell(options.spacing.button, button(options.url, options.buttonLabel)),
  );
  rows.push(
    cell("24px 32px 0", linkFallback(options.url, options.fallbackLabel)),
  );
  rows.push(cell("24px 32px 0", divider()));
  rows.push(
    cell("20px 32px 32px", paragraph(escapeHtml(options.closing), type.small), {
      last: true,
    }),
  );

  return emailDocument({
    lang: resolveLocale(options.locale),
    origin: options.origin,
    title: options.title,
    preheader: options.preheader,
    linkColor: palette.link,
    responsive,
    rows,
  });
}

/**
 * The two emails that end in six digits rather than a link.
 *
 * A code is read, not clicked, so the shape is inverted: the digits are the
 * largest thing on the page, spaced apart so they can be transcribed a glance
 * at a time, and there is no button to press and no URL to fall back to. They
 * are set in the serif display face at `display` size for one reason — it is
 * the one face in the set with unambiguous figures, and a 1 that reads as a 7
 * costs somebody their account.
 *
 * The digits sit in `codePanel`, which is as close to a copy button as a
 * message can get without JavaScript — see that function for why, and for why
 * its label carries the word "code".
 *
 * Nothing here links anywhere. That is deliberate: an email that asks for a
 * code and also offers a button teaches the reader that both are normal, which
 * is precisely the habit a phishing mail relies on.
 */
function codeEmail(options: {
  locale: string | null | undefined;
  origin: string;
  code: string;
  title: string;
  preheader: string;
  lead: string;
  /** The panel's own label, which is shared between the two code emails. */
  codeLabel: string;
  sub: string;
  closing: string;
}): string {
  const rows: string[] = [
    cell("36px 32px 0", paragraph(escapeHtml(options.lead), type.lead)),
    cell(
      "20px 32px 0",
      codePanel(
        options.codeLabel,
        paragraph(escapeHtml(options.code), {
          ...type.display,
          weight: "bold",
          // Wide enough that each figure is read on its own, which is how a
          // code gets copied correctly onto a phone held in the other hand.
          letterSpacing: "6px",
          className: "display",
          selectable: true,
        }),
      ),
    ),
    cell("16px 32px 0", paragraph(escapeHtml(options.sub), type.secondary)),
    cell("24px 32px 0", divider()),
    cell("20px 32px 32px", paragraph(escapeHtml(options.closing), type.small), {
      last: true,
    }),
  ];

  return emailDocument({
    lang: resolveLocale(options.locale),
    origin: options.origin,
    title: options.title,
    preheader: options.preheader,
    linkColor: palette.link,
    responsive: ["panel", "display"],
    rows,
  });
}

/** The code that confirms a new account's address, typed back into the flow. */
export function renderVerifyCodeEmail(input: {
  locale: string | null | undefined;
  origin: string;
  code: string;
}): RenderedEmail {
  const t = emailTranslator(input.locale);

  return {
    subject: t("verifyCode.subject", { code: input.code }),
    text: t("verifyCode.text", { code: input.code }),
    html: codeEmail({
      locale: input.locale,
      origin: input.origin,
      code: input.code,
      title: t("verifyCode.title"),
      preheader: t("verifyCode.preheader"),
      lead: t("verifyCode.lead"),
      codeLabel: t("codeLabel"),
      sub: t("verifyCode.sub"),
      closing: t("verifyCode.closing"),
    }),
  };
}

/** The code that signs an account in when it has no password to type. */
export function renderSignInCodeEmail(input: {
  locale: string | null | undefined;
  origin: string;
  code: string;
}): RenderedEmail {
  const t = emailTranslator(input.locale);

  return {
    subject: t("signInCode.subject", { code: input.code }),
    text: t("signInCode.text", { code: input.code }),
    html: codeEmail({
      locale: input.locale,
      origin: input.origin,
      code: input.code,
      title: t("signInCode.title"),
      preheader: t("signInCode.preheader"),
      lead: t("signInCode.lead"),
      codeLabel: t("codeLabel"),
      sub: t("signInCode.sub"),
      closing: t("signInCode.closing"),
    }),
  };
}

/** Welcome, and confirm the address the account was created with. */
export function renderVerifyEmail(input: {
  locale: string | null | undefined;
  /** The instance's public origin, which the header mark is served from. */
  origin: string;
  url: string;
}): RenderedEmail {
  const t = emailTranslator(input.locale);
  const subject = t("verify.subject");

  return {
    subject,
    text: t("verify.text", { url: input.url }),
    html: linkEmail({
      locale: input.locale,
      origin: input.origin,
      url: input.url,
      title: t("verify.title"),
      preheader: t("verify.preheader"),
      display: t("verify.display"),
      lead: t("verify.body"),
      leadSize: type.bodyLarge,
      buttonLabel: t("verify.button"),
      fallbackLabel: t("fallbackLabel"),
      closing: t("verify.closing"),
      spacing: { lead: "40px 32px 0", button: "20px 32px 0" },
    }),
  };
}

/** Set a new password after forgetting the old one. */
export function renderPasswordResetEmail(input: {
  locale: string | null | undefined;
  /** The instance's public origin, which the header mark is served from. */
  origin: string;
  url: string;
}): RenderedEmail {
  const t = emailTranslator(input.locale);
  const subject = t("reset.subject");

  return {
    subject,
    text: t("reset.text", { url: input.url }),
    html: linkEmail({
      locale: input.locale,
      origin: input.origin,
      url: input.url,
      title: t("reset.title"),
      preheader: t("reset.preheader"),
      lead: t("reset.lead"),
      leadSize: type.lead,
      sub: { text: t("reset.sub"), leading: 22 },
      buttonLabel: t("reset.button"),
      fallbackLabel: t("fallbackLabel"),
      closing: t("reset.closing"),
      // The one email whose lead cell carries bottom padding of its own.
      spacing: {
        lead: "36px 32px 8px",
        sub: "20px 32px 0",
        button: "16px 32px 0",
      },
    }),
  };
}

/** Sent to the address an account is being moved *to*. */
export function renderEmailChangeEmail(input: {
  locale: string | null | undefined;
  /** The instance's public origin, which the header mark is served from. */
  origin: string;
  url: string;
}): RenderedEmail {
  const t = emailTranslator(input.locale);
  const subject = t("emailChange.subject");

  return {
    subject,
    text: t("emailChange.text", { url: input.url }),
    html: linkEmail({
      locale: input.locale,
      origin: input.origin,
      url: input.url,
      title: t("emailChange.title"),
      preheader: t("emailChange.preheader"),
      lead: t("emailChange.lead"),
      leadSize: type.lead,
      sub: { text: t("emailChange.sub"), leading: 23 },
      buttonLabel: t("emailChange.button"),
      fallbackLabel: t("fallbackLabel"),
      closing: t("emailChange.closing"),
      spacing: {
        lead: "36px 32px 0",
        sub: "18px 32px 0",
        button: "16px 32px 0",
      },
    }),
  };
}

/**
 * Sent to the address an account is being moved *away from*.
 *
 * The only email in the set with no primary button, because from this address
 * there is nothing to confirm. The single action is defensive, and it sits in
 * the tinted panel rather than competing with a button that would look like
 * the thing to do.
 */
export function renderEmailChangeNoticeEmail(input: {
  locale: string | null | undefined;
  /** The instance's public origin, which the header mark is served from. */
  origin: string;
  newEmail: string;
  /** Where someone who did not ask for this should go. */
  recoverUrl: string;
}): RenderedEmail {
  const t = emailTranslator(input.locale);
  const subject = t("emailChangeNotice.subject");

  /*
   * `markup` rather than a pre-wrapped parameter: the emphasis belongs to the
   * sentence, and where it falls is a decision for whoever writes the sentence
   * in each language. It does not escape what it interpolates, so the address
   * is escaped here — a `z.email()` value cannot carry a bracket, but nothing
   * about this function guarantees its caller validated one.
   */
  const lead = t.markup("emailChangeNotice.lead", {
    email: escapeHtml(input.newEmail),
    strong: (chunks) => `<strong style="font-weight:bold">${chunks}</strong>`,
  });

  const rows = [
    cell("36px 32px 0", paragraph(lead, type.lead)),
    cell(
      "18px 32px 0",
      paragraph(escapeHtml(t("emailChangeNotice.sub")), {
        ...type.secondary,
        leading: 23,
      }),
    ),
    cell(
      "24px 32px 0",
      warningPanel({
        title: t("emailChangeNotice.warningTitle"),
        body: t("emailChangeNotice.warningBody"),
        href: input.recoverUrl,
        linkLabel: t("emailChangeNotice.warningLink"),
      }),
    ),
    cell(
      "24px 32px 32px",
      paragraph(escapeHtml(t("emailChangeNotice.closing")), type.closing),
      { last: true },
    ),
  ];

  return {
    subject,
    text: t("emailChangeNotice.text", {
      email: input.newEmail,
      url: input.recoverUrl,
    }),
    html: emailDocument({
      lang: resolveLocale(input.locale),
      origin: input.origin,
      title: t("emailChangeNotice.title"),
      preheader: t("emailChangeNotice.preheader"),
      // The whole email's accent, so the one link in it is not coral on a
      // message that is otherwise about something having gone wrong.
      linkColor: palette.destructive,
      responsive: ["panel"],
      rows,
    }),
  };
}
