import "server-only";
import { getTranslations } from "next-intl/server";
import { cache } from "react";
import {
  AuthenticationRequiredError,
  AuthorizationError,
  authorizeGroup,
  type GroupAccess,
} from "@/lib/security/authorization";
import { getCurrentActor } from "@/lib/security/actor";
import { logger } from "@/lib/logger";
import { AllocationError } from "@/modules/expenses/allocation";
import { EditConflictError } from "@/modules/expenses/edit-conflict";
import { AuthError } from "@/modules/auth/service";
import { CurrencyConfigurationError } from "@/modules/currencies/conversion";
import { InvalidAmountError } from "@/modules/currencies/money";
import { RecurrenceError } from "@/modules/recurring/schedule";
import { UploadRejectedError } from "@/modules/attachments/service";
import { ImportError } from "@/modules/imports/service";
import { JoinError } from "@/modules/join/service";
import { OpenBalanceError } from "@/modules/balances/open-balance";
import { PasswordError } from "@/modules/auth/passwords";
import { ReminderError } from "@/modules/reminders/service";
import { RateLimitedError } from "@/lib/security/rate-limit";
import { ProofOfWorkError } from "@/lib/security/proof-of-work";
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
  /**
   * The refusal's reason, for the few a screen does something about.
   *
   * An edit refused because somebody else changed the entry offers to reload
   * it, and without this the form would be matching on words that change with
   * the language. Only the codes in `ACTIONABLE_CODES` are carried — see there.
   */
  readonly code?: string;
  readonly data?: T;
}

export function actionOk<T>(data?: T): ActionResult<T> {
  return { ok: true, data };
}

export function actionError(
  message: string,
  code?: string,
): ActionResult<never> {
  return code === undefined
    ? { ok: false, error: message }
    : { ok: false, error: message, code };
}

/**
 * Resolves group access for the current actor, or throws.
 *
 * Asked at most once per server render for the same group and flag. Every
 * group screen asks twice — the group layout, before anything under it loads,
 * and then the page itself, which is right, because a page must not trust that
 * a layout ran — and the second ask used to be a second membership query.
 */
export async function requireGroupAccess(
  groupId: string,
  options: { requireActive?: boolean } = {},
): Promise<GroupAccess> {
  return authorizeOncePerRender(groupId, options.requireActive ?? false);
}

/*
 * The actor is not part of the key because a render has exactly one:
 * `getCurrentActor` is itself remembered for the render, so within it the
 * group id and the flag are the whole question. The flag stays in the key so
 * that a read-only answer the layout was given can never stand in for a page
 * that asks to write to an archived group.
 *
 * React's `cache` gives exactly the lifetime that is safe here, and no more.
 * Every render starts from nothing, including the one Next.js runs after a
 * Server Action — so the render that follows an action removing somebody asks
 * again and finds them gone — and the action itself, like a route handler,
 * runs outside any render, where `cache` calls straight through.
 */
const authorizeOncePerRender = cache(
  async (groupId: string, requireActive: boolean): Promise<GroupAccess> =>
    authorizeGroup(await getCurrentActor(), groupId, { requireActive }),
);

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
  EditConflictError,
  ImportError,
  InvalidAmountError,
  JoinError,
  OpenBalanceError,
  PasswordError,
  ProofOfWorkError,
  RateLimitedError,
  RecurrenceError,
  ReminderError,
  UploadRejectedError,
] as const;

function isSafeError(error: unknown): error is Error {
  return SAFE_ERRORS.some((candidate) => error instanceof candidate);
}

/**
 * The reason codes a result carries beside its sentence.
 *
 * A short list rather than every code an error has. Most codes exist to pick
 * a translation — see `describeError` — and mean nothing to a screen; some,
 * like an allocation error's `internal`, are not reasons at all. Carrying them
 * all would make every refusal's shape depend on a field nobody reads.
 *
 * - `editConflict`: the edit form offers to reload the entry.
 * - `emailUnverified`: the sign-in form puts the caret back in the address
 *   rather than the password, since the password was not what was wrong.
 */
const ACTIONABLE_CODES: ReadonlySet<string> = new Set([
  "editConflict",
  "emailUnverified",
]);

function reasonCode(error: Error): string | undefined {
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" && ACTIONABLE_CODES.has(value)
    ? value
    : undefined;
}

/**
 * Wraps an action body so failures become `ActionResult` rather than an
 * unhandled rejection. Unexpected errors are logged — in full, less a failed
 * query's values — and reported to the user as a generic message.
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
      return actionError(await describeError(error), reasonCode(error));
    }

    observe(name, "failed", startedAt);
    logger.error({ action: name, err: error }, "Action failed");

    // The error, with its stack, has just gone to this instance's own log
    // where an administrator can read it — less the values of a failed query,
    // which the logger's `err` serializer drops. What may leave the instance —
    // if, and only if, crash reports were switched on — is the class name and
    // the word "server-action". Never awaited into the response path: the user
    // is getting an error message either way, and they should not wait for a
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
