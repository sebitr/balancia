import {
  renderEmailChangeEmail,
  renderEmailChangeNoticeEmail,
  renderPasswordResetEmail,
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
 */

const ORIGIN = "https://balancia.app";

export const SAMPLE = {
  verifyToken: "OQAWX41O13F2eGwQR9_FP6KpFdng9IvEYhXTsAOIoIE",
  resetToken: "AwA5-bcRwgnFpuqKIoFWklggr0jcCEh67gt7M1Qku1Y",
  changeToken: "rXk7XUERrBUbxb0TFTynNgtu1BPnlHfpVJhOHwCfYIc",
  newEmail: "sebastien@trosset.net",
} as const;

/** Keyed by the design handoff's file names, which the fixtures reuse. */
export function renderAll(locale: string): Record<string, RenderedEmail> {
  return {
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
