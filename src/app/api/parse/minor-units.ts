import {
  InvalidAmountError,
  parseMajorAmount,
} from "@/modules/currencies/money";

/**
 * A parsed amount in the units every write speaks, or null.
 *
 * The parser answers in *major* units, because that is what somebody said out
 * loud and what the drawer puts straight into a field a person reads. Every
 * write in this API takes *minor* units, because that is what the money domain
 * stores. A browser has `parseMajorAmount` and the ISO 4217 table sitting next
 * to it; a shortcut, a crontab or a webhook glue script has neither, and
 * "multiply by a hundred" is wrong for the yen, wrong for the dinar, and wrong
 * in a way that surfaces on somebody else's currency months later.
 *
 * So the conversion happens on the side that owns the table. This is the whole
 * of what stood between `/api/parse` and the expenses route composing without
 * a client writing currency arithmetic of its own.
 *
 * Null is an answer rather than a failure, and there are three ways to reach
 * it. A sentence with no amount in it has nothing to convert. A sentence
 * naming no currency, from a caller that offered no `fallbackCurrency`, has no
 * exponent to convert against — that caller is picking the group afterwards
 * and will convert then. And "24.50 yen" carries more decimals than the yen
 * has, which `parseMajorAmount` refuses rather than truncating, because
 * silently dropping a digit loses money. All three leave `amountText` intact
 * and the field one tap from done, which is how the parser fails everywhere
 * else.
 *
 * Pure, and its own file, because a `route.ts` may only export handlers — and
 * because currency arithmetic that decides what a caller writes to a ledger
 * deserves a table of cases rather than a scenario somebody has to build.
 */
export function minorUnitsFor(
  amountText: string,
  currency: string,
): string | null {
  if (amountText === "" || currency === "") return null;
  try {
    return parseMajorAmount(amountText, currency).amount.toString();
  } catch (error) {
    // Anything else is a bug rather than an unconvertible amount, and a parse
    // that answers 500 is better than one that quietly says "no amount".
    if (error instanceof InvalidAmountError) return null;
    throw error;
  }
}
