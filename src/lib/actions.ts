import "server-only";
import { getTranslations } from "next-intl/server";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  authorizeGroup,
  type GroupAccess,
} from "@/lib/security/authorization";
import { getCurrentActor } from "@/lib/security/actor";
import { logger } from "@/lib/logger";
import { AllocationError } from "@/modules/expenses/allocation";
import { AuthError } from "@/modules/auth/service";
import { CurrencyConfigurationError } from "@/modules/currencies/conversion";
import { InvalidAmountError } from "@/modules/currencies/money";
import { RecurrenceError } from "@/modules/recurring/schedule";
import { UploadRejectedError } from "@/modules/attachments/service";
import { ImportError } from "@/modules/imports/service";
import { RateLimitedError } from "@/lib/security/rate-limit";

/**
 * Shared plumbing for Server Actions.
 *
 * Two jobs: get the caller an authorized `GroupAccess` before any data is
 * touched, and turn domain exceptions into messages that are safe to show —
 * so an unexpected error never leaks a stack trace or a query into the UI.
 */

export interface ActionResult<T = void> {
  readonly ok: boolean;
  readonly error?: string;
  readonly data?: T;
}

export function actionOk<T>(data?: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionError(message: string): ActionResult<never> {
  return { ok: false, error: message };
}

/** Resolves group access for the current actor, or throws. */
export async function requireGroupAccess(
  groupId: string,
  options: { requireActive?: boolean } = {},
): Promise<GroupAccess> {
  const actor = await getCurrentActor();
  return authorizeGroup(actor, groupId, options);
}

/**
 * These carry messages written for humans and are safe to surface verbatim.
 *
 * `AuthError` belongs here for the same reason as the rest: its messages are
 * deliberately non-enumerating — every credential failure returns one identical
 * sentence — so showing them tells an attacker nothing while telling an honest
 * user why they cannot get in. Without it, "confirm your email address" and
 * "that password did not work" both surface as an unexplained server error,
 * and every mistyped password is logged at ERROR level.
 */
const SAFE_ERRORS = [
  AllocationError,
  AuthError,
  AuthorizationError,
  AuthenticationRequiredError,
  CurrencyConfigurationError,
  ImportError,
  InvalidAmountError,
  RateLimitedError,
  RecurrenceError,
  UploadRejectedError,
] as const;

function isSafeError(error: unknown): error is Error {
  return SAFE_ERRORS.some((candidate) => error instanceof candidate);
}

/**
 * The stable reason code a domain error may carry.
 *
 * Errors that have one are translated into the reader's language; the rest
 * fall back to their English `message`, which is still an improvement on a
 * blank failure and lets codes be added incrementally.
 */
function codeOf(error: Error): string | null {
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : null;
}

async function describe(error: Error): Promise<string> {
  const code = codeOf(error);
  if (!code) return error.message;
  const t = await getTranslations("serverErrors");
  const key = code as Parameters<typeof t.has>[0];
  if (!t.has(key)) return error.message;
  // Errors that interpolate (an upload limit, say) carry their own values.
  const params = (error as { params?: Record<string, string | number> }).params;
  return t(key, params);
}

/**
 * Wraps an action body so failures become `ActionResult` rather than an
 * unhandled rejection. Unexpected errors are logged in full and reported to
 * the user as a generic message.
 */
export async function runAction<T>(
  name: string,
  body: () => Promise<T>,
): Promise<ActionResult<T>> {
  try {
    return actionOk(await body());
  } catch (error) {
    if (isSafeError(error)) {
      return actionError(await describe(error));
    }
    logger.error(
      {
        action: name,
        err:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      },
      "Action failed",
    );
    const t = await getTranslations("serverErrors");
    return actionError(t("generic"));
  }
}
