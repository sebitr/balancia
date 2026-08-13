import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Optional SMTP delivery.
 *
 * Balancia works without a mail server: verification and password recovery are
 * simply not offered. When SMTP is configured, this is the single place that
 * sends anything, so failures are logged consistently and never leak the
 * message body.
 */

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;

  const env = getEnv();
  if (!env.smtpEnabled || !env.SMTP_HOST) {
    transporter = null;
    return transporter;
  }

  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? (env.SMTP_SECURE ? 465 : 587),
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });
  return transporter;
}

export interface MailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export async function sendMail(message: MailMessage): Promise<void> {
  const env = getEnv();
  const transport = getTransporter();
  if (!transport || !env.SMTP_FROM) {
    logger.warn(
      { subject: message.subject },
      "SMTP is not configured; skipping outgoing email",
    );
    return;
  }

  try {
    await transport.sendMail({
      from: env.SMTP_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    logger.info({ subject: message.subject }, "Sent email");
  } catch (error) {
    // Never include the body: it may carry a reset link.
    logger.error(
      {
        subject: message.subject,
        err: error instanceof Error ? error.message : String(error),
      },
      "Failed to send email",
    );
    throw new Error("Unable to send email. Check the SMTP configuration.");
  }
}

/** Used by the UI to decide whether to offer password recovery. */
export function isMailEnabled(): boolean {
  return getEnv().smtpEnabled;
}

/** Test hook. */
export function resetMailer(): void {
  transporter = undefined;
}
