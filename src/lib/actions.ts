import "server-only";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  authorizeGroup,
  type GroupAccess,
} from "@/lib/security/authorization";
import { getCurrentActor } from "@/lib/security/actor";
import { logger } from "@/lib/logger";
import { AllocationError } from "@/modules/expenses/allocation";
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

/** These carry messages written for humans and are safe to surface verbatim. */
const SAFE_ERRORS = [
  AllocationError,
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
      return actionError(error.message);
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
    return actionError(
      "Something went wrong on the server. Nothing was changed.",
    );
  }
}
