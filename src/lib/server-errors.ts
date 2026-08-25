import "server-only";
import { getTranslations } from "next-intl/server";

/**
 * Turning a domain error into a sentence in the reader's language.
 *
 * Every error a caller is meant to read carries an English `message` — written
 * for a person, and the only thing there was before this — and, where one has
 * been given, a stable `code` naming the reason. The code is the translatable
 * part: it maps to a key under `serverErrors`, so the same refusal reads as
 * French to a French reader and stays a single sentence in the log.
 *
 * The English message is the fallback, deliberately. Codes were added to the
 * errors that had readers waiting for them and can be added to the rest one at
 * a time; an error that has none is still better answered in English than
 * swallowed into "something went wrong".
 *
 * Both funnels use this — Server Actions in `lib/actions.ts` and the route
 * handlers the browser talks to. The mobile API in `app/api/mobile.ts` is the
 * exception on purpose: it answers a native client that presents its own
 * strings, so translating there would be translating twice.
 */

/** The stable reason code a domain error may carry. */
function codeOf(error: Error): string | null {
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" ? value : null;
}

export async function describeError(error: Error): Promise<string> {
  const code = codeOf(error);
  if (!code) return error.message;
  const t = await getTranslations("serverErrors");
  const key = code as Parameters<typeof t.has>[0];
  if (!t.has(key)) return error.message;
  // Errors that interpolate (an upload limit, say) carry their own values.
  const params = (error as { params?: Record<string, string | number> }).params;
  return t(key, params);
}
