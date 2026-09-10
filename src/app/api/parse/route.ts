import { z } from "zod";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import {
  apiActor,
  invalidInput,
  mobileApiError,
  noStore,
  readJsonBody,
} from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";
import { SUPPORTED_CURRENCY_CODES } from "@/modules/currencies/iso-4217";
import { heardEntry } from "@/components/entries/heard-entry";
import { minorUnitsFor } from "./minor-units";

const ROUTE = "/api/parse";

/**
 * A sentence turned into an amount, a currency and a description.
 *
 * `heardEntry` was written for the dictate button and there is nothing about a
 * microphone in it: it takes a line of text and hands back three fields. Which
 * means the recogniser is only the first mouth. Shared text, a bank's SMS, a
 * line copied out of a group chat, a block lifted off a photo by Live Text —
 * every one of them is a string somebody already has, and every one of them
 * wants the same three fields out the other end.
 *
 * So the parser is exposed rather than reimplemented, for the same reason the
 * categorizer next door is: a second copy in a second language is how the two
 * ends start disagreeing about what a sentence says. That is not hypothetical
 * here — the parser was rewritten twice in the days after it shipped, and each
 * rewrite fixed a figure nobody said landing in a field nobody was watching.
 * One of those is a bad afternoon; two copies of it drifting apart is a
 * balance that quietly stops adding up.
 *
 * Deliberately not group-scoped, on `/api/rates`' argument: a parse reads no
 * data and writes none, so there is no group to be a member of. The only
 * access rule is that the caller be somebody — a signed-in user or a guest
 * with a live session — which, with the rate limit, is what keeps this from
 * being an open text-processing endpoint on somebody else's electricity.
 *
 * The parser's three rules survive the trip out here unchanged, and the middle
 * one is why `fallbackCurrency` is a parameter rather than a default: a
 * sentence with no currency in it does not mean "no currency", it means the
 * group's, and only the caller knows which that is.
 */

const bodySchema = z.object({
  text: z.string().max(2000, "That is more text than one entry."),
  /**
   * What the entry is denominated in when the sentence names nothing.
   *
   * Optional, and an empty string is the honest answer for a caller with no
   * group in hand yet — a share-sheet shortcut picks the group afterwards. The
   * parser hands back "" in that case, which reads as "leave it alone" rather
   * than as a currency.
   */
  fallbackCurrency: z
    .string()
    .refine(
      (value) => value === "" || SUPPORTED_CURRENCY_CODES.includes(value),
      "fallbackCurrency must be an ISO 4217 code this instance accepts.",
    )
    .optional(),
});

export async function POST(request: Request) {
  return trackRoute(ROUTE, "POST", () => handlePost(request));
}

async function handlePost(request: Request) {
  try {
    const actor = await apiActor(request, ROUTE, "POST");
    if (!actor) {
      return noStore({ error: "Sign in to continue." }, { status: 401 });
    }

    // Thrown rather than answered here, so the 429 carries the same
    // `Retry-After` every other route's does: a shortcut that gets told to
    // wait can only obey a number.
    const limit = await consumeRateLimit("parseText", await getClientIp());
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);

    const parsed = bodySchema.safeParse(await readJsonBody(request));
    if (!parsed.success) return invalidInput(parsed.error);

    const heard = heardEntry(
      parsed.data.text,
      parsed.data.fallbackCurrency ?? "",
    );

    // Empty text and unreadable text answer alike, and the shape says why:
    // there is no error case here. Words that hold no amount come back as the
    // description with `amountText` empty, which is the parser's own graceful
    // failure — the reader is one field from done rather than back where they
    // started — and a caller treating 200-with-no-amount as a refusal would be
    // throwing away the half that did work.
    //
    // `amountMinor` is the same figure in the units the expenses route takes,
    // so a caller with no ISO 4217 table can compose the two without inventing
    // currency arithmetic. It is null wherever that conversion cannot be made
    // honestly; `minor-units.ts` says which cases and why.
    return noStore({
      amountText: heard.amountText,
      currency: heard.currency,
      description: heard.description,
      amountMinor: minorUnitsFor(heard.amountText, heard.currency),
    });
  } catch (error) {
    return mobileApiError(error, `${ROUTE} POST`);
  }
}
