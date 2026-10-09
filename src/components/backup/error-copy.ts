/**
 * Which sentence a failure code gets.
 *
 * The backend records a code, never a sentence (`modules/backup/errors.ts`),
 * and the screen words it in the reader's language from `cloudBackup.error`.
 * Two vocabularies reach a screen: the codes a run records
 * (`BackupErrorCode`) and the refusals the actions answer with
 * (`BackupInputCode`), which overlap on `notFound`/`noKey` and are spelled
 * differently from the catalogue's keys (`not_found` against `notFound`).
 * Both are mapped here, once, and anything unrecognised reads as `unknown`
 * rather than as a raw key on screen.
 *
 * Written against a minimal translate function rather than a hook so the same
 * table serves the server page (a failed reconnect, read from the URL) and the
 * client components.
 */

type SentenceKey =
  | "error.reconnect"
  | "error.forbidden"
  | "error.quota"
  | "error.notFound"
  | "error.unreachable"
  | "error.rateLimited"
  | "error.endpointBlocked"
  | "error.unavailable"
  | "error.noKey"
  | "error.invalidKey"
  | "error.tooMany"
  | "error.invalidDetails"
  | "error.unknown";

type HintKey =
  | "error.reconnectHint"
  | "error.forbiddenHint"
  | "error.quotaHint"
  | "error.notFoundHint"
  | "error.unreachableHint"
  | "error.rateLimitedHint"
  | "error.endpointBlockedHint";

export type Translate = (
  key: SentenceKey | HintKey,
  values?: { provider: string },
) => string;

const SENTENCES: Readonly<Record<string, SentenceKey>> = {
  reconnect: "error.reconnect",
  forbidden: "error.forbidden",
  quota: "error.quota",
  not_found: "error.notFound",
  notFound: "error.notFound",
  unreachable: "error.unreachable",
  rate_limited: "error.rateLimited",
  endpoint_blocked: "error.endpointBlocked",
  unavailable: "error.unavailable",
  no_key: "error.noKey",
  noKey: "error.noKey",
  invalidKey: "error.invalidKey",
  tooMany: "error.tooMany",
  invalidDetails: "error.invalidDetails",
  unknown: "error.unknown",
};

/** The sentences that come with one line of what to do about it. */
const HINTS: Readonly<Record<string, HintKey>> = {
  reconnect: "error.reconnectHint",
  forbidden: "error.forbiddenHint",
  quota: "error.quotaHint",
  not_found: "error.notFoundHint",
  notFound: "error.notFoundHint",
  unreachable: "error.unreachableHint",
  rate_limited: "error.rateLimitedHint",
  endpoint_blocked: "error.endpointBlockedHint",
};

export interface ErrorCopy {
  readonly sentence: string;
  /** What to do next, where the catalogue has a line for it. */
  readonly hint: string | null;
}

export function errorCopy(
  t: Translate,
  code: string | null | undefined,
  provider: string,
): ErrorCopy {
  // `hasOwn`, because a code is text from a URL or a database and
  // `"constructor"` is a property of every object.
  const sentence: SentenceKey =
    code && Object.hasOwn(SENTENCES, code) ? SENTENCES[code] : "error.unknown";
  const hint: HintKey | undefined =
    code && Object.hasOwn(HINTS, code) ? HINTS[code] : undefined;
  return {
    sentence: t(sentence, { provider }),
    hint: hint ? t(hint, { provider }) : null,
  };
}
