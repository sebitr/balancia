import { AsYouType } from "libphonenumber-js";
import type { SupportedCountry } from "@/modules/settlements/payment-methods";
import { payoutFieldFor } from "./fields";

/**
 * How a payout detail is written for a person to read.
 *
 * The counterpart to `fields.ts`, which decides what a detail must *be*: this
 * decides what it looks like. The two disagree on purpose — the server stores
 * `+41791234567`, because that is the one form two of them can be compared in,
 * and thirteen unbroken digits are exactly what a phone number must never be
 * shown as. Nobody reads a number in that shape, and nobody can check theirs
 * against it without counting on their fingers.
 *
 * So the grouping is put back on the way in and on the way out, by
 * libphonenumber, which carries the numbering plan of every country and knows
 * that Switzerland groups 79 123 45 67 and Italy 312 345 6789. Spacing is
 * cosmetic to everything downstream: `normalizePayoutDetail` strips it before
 * the detail is stored, so a field that reformats as it is typed changes what
 * is read and nothing else.
 */

/**
 * One keystroke's worth of formatting.
 *
 * `AsYouType` is fed the whole field rather than the new character, which is
 * what makes this safe to call from a controlled input: it is a pure function
 * of the text, so a paste, an undo and a typed digit all land in the same
 * place.
 *
 * Two things it is not allowed to do. It must not drop a digit — a number
 * longer than its country's plan is somebody's number that we have simply not
 * heard of, and swallowing part of it as they type is unforgivable — and it
 * must not answer at all until there is a digit to work with, or the `+` that
 * every international number starts with disappears the moment it is typed.
 *
 * The country is a hint for numbers typed the local way, without a `+`: a
 * Swiss `079 123 45 67` is grouped as Switzerland groups it. An explicit `+`
 * always wins, so a French number typed into TWINT is still formatted as
 * French.
 */
export function formatPhoneAsTyped(
  typed: string,
  country: SupportedCountry | null,
): string {
  const digits = typed.replace(/\D/g, "");
  if (digits === "") return typed;

  const formatted = new AsYouType(country ?? undefined).input(typed);
  return formatted.replace(/\D/g, "") === digits ? formatted : typed;
}

/**
 * A stored detail, as it should first appear in its own field.
 *
 * Only phone numbers change: an IBAN is stored in the groups of four it was
 * typed in, and everything else is stored exactly as its owner wrote it. The
 * country is read off the number itself, since anything the server kept has
 * its `+` and country code already.
 */
export function displayPayoutDetail(method: string, detail: string): string {
  if (payoutFieldFor(method) !== "phone") return detail;
  return formatPhoneAsTyped(detail, null);
}

/** The same, for a whole saved list on its way into a form. */
export function displayPayoutEntries<
  T extends { readonly method: string; readonly detail: string },
>(entries: readonly T[]): readonly T[] {
  return entries.map((entry) => ({
    ...entry,
    detail: displayPayoutDetail(entry.method, entry.detail),
  }));
}
