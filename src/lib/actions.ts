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
import { ReminderError } from "@/modules/reminders/service";
import { RateLimitedError } from "@/lib/security/rate-limit";
import { reportCrash } from "@/lib/telemetry/crash-reporter";
import { describeError } from "@/lib/server-errors";
import {
  actionDuration,
  actionOutcomes,
  secondsSince,
} from "@/lib/metrics/metrics";

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
  ReminderError,
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
  const startedAt = performance.now();
  try {
    const result = actionOk(await body());
    observe(name, "ok", startedAt);
    return result;
  } catch (error) {
    if (isSafeError(error)) {
      // A refusal the user is meant to see — a rate limit, a bad amount, no
      // access. Counted apart from a failure, because an alert on "actions
      // that went wrong" should not fire on somebody mistyping a percentage.
      observe(name, "rejected", startedAt);
      return actionError(await describeError(error));
    }

    observe(name, "failed", startedAt);
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

    // The full error, with its stack, has just gone to this instance's own log
    // where an administrator can read it. What may leave the instance — if,
    // and only if, crash reports were switched on — is the class name and the
    // word "server-action". Never awaited into the response path: the user is
    // getting an error message either way, and they should not wait for a
    // report to be sent first.
    void reportCrash(error, "server-action");

    const t = await getTranslations("serverErrors");
    return actionError(t("generic"));
  }
}

function observe(name: string, outcome: string, startedAt: number): void {
  actionDuration().observe(secondsSince(startedAt), { action: name });
  actionOutcomes().increment({ action: name, outcome });
}
