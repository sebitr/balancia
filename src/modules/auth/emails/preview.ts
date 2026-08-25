import {
  renderEmailChangeEmail,
  renderEmailChangeNoticeEmail,
  renderPasswordResetEmail,
  renderSignInCodeEmail,
  renderVerifyCodeEmail,
  renderVerifyEmail,
  type RenderedEmail,
} from "./templates";

/**
 * One set of every email, from one set of sample values.
 *
 * Shared by `scripts/render-emails.ts`, which writes it to disk, and by the
 * template tests, which assert what it writes — so the fixtures and the
 * assertions cannot drift by being generated from different inputs.
 *
 * The tokens and the address are the ones the design handoff used. Keeping
 * them is what lets the rendered English files be diffed against those
 * references directly; see tests/fixtures/emails/README.md.
 *
 * The two code emails have no handoff to be diffed against. They are rendered
 * anyway, because they are emails, and an email nothing renders is an email
 * whose markup changes unreviewed.
 */

const ORIGIN = "https://balancia.app";

export const SAMPLE = {
  verifyToken: "OQAWX41O13F2eGwQR9_FP6KpFdng9IvEYhXTsAOIoIE",
  resetToken: "AwA5-bcRwgnFpuqKIoFWklggr0jcCEh67gt7M1Qku1Y",
  changeToken: "rXk7XUERrBUbxb0TFTynNgtu1BPnlHfpVJhOHwCfYIc",
  newEmail: "sebastien@trosset.net",
  // Six figures with no repeat and no run, so a fixture diff that drops or
  // reorders one is visible rather than plausible.
  code: "148293",
} as const;

/** Keyed by the fixture file names; the four link emails reuse the handoff's. */
export function renderAll(locale: string): Record<string, RenderedEmail> {
  return {
    "verify-code-email": renderVerifyCodeEmail({
      locale,
      origin: ORIGIN,
      code: SAMPLE.code,
    }),
    "sign-in-code-email": renderSignInCodeEmail({
      locale,
      origin: ORIGIN,
      code: SAMPLE.code,
    }),
    "reset-password-email": renderPasswordResetEmail({
      locale,
      origin: ORIGIN,
      url: `${ORIGIN}/reset-password?token=${SAMPLE.resetToken}`,
    }),
    "verify-email": renderVerifyEmail({
      locale,
      origin: ORIGIN,
      url: `${ORIGIN}/verify-email?token=${SAMPLE.verifyToken}`,
    }),
    "confirm-new-email": renderEmailChangeEmail({
      locale,
      origin: ORIGIN,
      url: `${ORIGIN}/confirm-email?token=${SAMPLE.changeToken}`,
    }),
    "email-change-notice": renderEmailChangeNoticeEmail({
      locale,
      origin: ORIGIN,
      newEmail: SAMPLE.newEmail,
      recoverUrl: `${ORIGIN}/forgot-password`,
    }),
  };
}
