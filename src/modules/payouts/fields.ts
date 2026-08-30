import {
  PAYMENT_METHOD_IDS,
  type PaymentMethodId,
} from "@/modules/settlements/payment-methods";

/**
 * What each way of being paid needs written down, and what counts as written
 * down correctly.
 *
 * A payout method is a promise to a stranger — the person who owes you reads
 * it, opens their banking app and types it in. A transposed digit in an IBAN
 * or a phone number missing its country code does not fail loudly; it fails at
 * their end, quietly, and the money does not arrive. So the shapes are checked
 * here rather than trusted, and checked in the one place both the browser and
 * the server can reach.
 *
 * Six kinds, and the split is by *what the reader has to type*, not by brand:
 *
 *  - `none` — cash and cheques carry nothing. There is nobody to send to.
 *  - `phone` — the schemes built on a mobile number, checked against E.164.
 *  - `iban` — checked with the mod-97 checksum, which is what it is for.
 *  - `email` — an address on an account somewhere.
 *  - `handle` — a name inside one service: a Revtag, a $cashtag, a UPI id.
 *  - `link` — a page that collects the money, PayPal.me being the one.
 *  - `text` — everything whose format is the provider's business, not ours.
 *
 * The `text` fallback is deliberate and matches the rule the method list
 * already follows: this decides what is *offered*, never what is *allowed*.
 * Refusing to store something because it did not match a pattern we invented
 * would be worse than storing what the owner says is right.
 */

export type PayoutFieldKind =
  "none" | "phone" | "iban" | "email" | "handle" | "link" | "text";

/** The longest detail worth storing; the same cap the settle row already uses. */
export const PAYOUT_DETAIL_MAX_LENGTH = 120;

/**
 * Which field each method asks for.
 *
 * Anything not named here asks for `text`, so a method added to the vocabulary
 * without a thought here still works — it simply gets the unopinionated field.
 */
const FIELDS: Partial<Record<PaymentMethodId, PayoutFieldKind>> = {
  bancomat_pay: "phone",
  bank: "iban",
  bizum: "phone",
  blik: "phone",
  cash: "none",
  cash_app: "handle",
  cheque: "none",
  interac: "email",
  lydia: "phone",
  mbway: "phone",
  mobilepay: "phone",
  monzo: "handle",
  n26: "iban",
  payconiq: "phone",
  payid: "handle",
  paypal: "link",
  pix: "handle",
  revolut: "handle",
  satispay: "phone",
  swish: "phone",
  tikkie: "phone",
  twint: "phone",
  upi: "handle",
  venmo: "handle",
  vipps: "phone",
  wero: "phone",
  // A Wisetag, not the email on the account. Both identify the same person to
  // Wise, but only one of them is what `wise.com/pay/me/<wisetag>` is built
  // from — and that link is the difference between a detail to retype and a
  // page that opens on the right person.
  //
  // Details already stored under the old kind are left alone rather than
  // migrated: an email is still a true answer to "how do I pay you on Wise",
  // and rewriting somebody's saved detail into a Wisetag we would have to
  // guess at is not a repair. `isSimpleHandle` refuses to build a link from
  // one, so an old detail shows as copyable text exactly as it does today.
  wise: "handle",
  zelle: "email",
};

export function payoutFieldFor(method: string): PayoutFieldKind {
  return FIELDS[method as PaymentMethodId] ?? "text";
}

/** Every method that needs nothing typed, for the callers that skip a field. */
export function needsDetail(method: string): boolean {
  return payoutFieldFor(method) !== "none";
}

export type PayoutFieldError =
  "required" | "tooLong" | "phone" | "iban" | "email" | "link";

/**
 * Checks one detail against its method, returning a catalogue key or null.
 *
 * Whitespace is not an error — people paste IBANs in groups of four and write
 * phone numbers with spaces in them, and both are the *correct* way to read
 * them out. `normalizePayoutDetail` is what decides how they are stored.
 */
export function validatePayoutDetail(
  method: string,
  detail: string,
): PayoutFieldError | null {
  const kind = payoutFieldFor(method);
  const value = detail.trim();

  if (kind === "none") return null;
  if (value.length === 0) return "required";
  if (value.length > PAYOUT_DETAIL_MAX_LENGTH) return "tooLong";

  switch (kind) {
    case "phone":
      return isE164(value) ? null : "phone";
    case "iban":
      return isIban(value) ? null : "iban";
    case "email":
      return isEmail(value) ? null : "email";
    case "link":
      return isLink(value) ? null : "link";
    default:
      // A handle or a free-text detail: the provider owns its shape, and
      // guessing at it would reject valid ones.
      return null;
  }
}

/**
 * How a detail is stored.
 *
 * Phone numbers and IBANs lose their spacing, because those two are compared
 * and copied by machines as often as by people. Everything else keeps exactly
 * what was typed, minus the ends — a Revtag's capitals are its owner's
 * business.
 */
export function normalizePayoutDetail(method: string, detail: string): string {
  const value = detail.trim();
  const kind = payoutFieldFor(method);
  if (kind === "none") return "";
  if (kind === "phone") return value.replace(/[\s.\-()]/g, "");
  if (kind === "iban") return value.replace(/\s/g, "").toUpperCase();
  return value;
}

/**
 * E.164: a plus, a country code that cannot start with zero, up to fifteen
 * digits in total.
 *
 * The plus is required rather than assumed. A number without one is only
 * dialable from inside the country that issued it, and the whole point of
 * writing it down here is that somebody abroad can pay you.
 */
function isE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value.replace(/[\s.\-()]/g, ""));
}

function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(value);
}

/**
 * A link that collects money, written the way people actually write it:
 * `paypal.me/sebtr`, with or without a scheme.
 *
 * A scheme is not required and not added — this is shown, not fetched.
 */
function isLink(value: string): boolean {
  const withoutScheme = value.replace(/^https?:\/\//i, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}\/[^\s]+$/i.test(withoutScheme);
}

/**
 * IBAN, by the checksum it was designed with.
 *
 * Two letters, two check digits, then up to thirty alphanumerics. The check is
 * mod-97 over the string rotated four characters and with letters expanded to
 * numbers — which catches every single-character slip and every transposition
 * of adjacent characters, the two mistakes people actually make. Computed
 * digit by digit because a 34-character IBAN is a number far beyond what a
 * double can hold.
 *
 * Country-specific lengths are not checked. Getting the length right for
 * seventy-odd countries is a table that goes stale, and the checksum already
 * refuses the mistakes that matter.
 */
function isIban(value: string): boolean {
  const compact = value.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(compact)) return false;

  const rotated = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const character of rotated) {
    const digits =
      character >= "A" && character <= "Z"
        ? String(character.charCodeAt(0) - 55)
        : character;
    for (const digit of digits) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }
  return remainder === 1;
}

/** Whether a stored code is one the app knows how to label. */
export function isKnownPayoutMethod(method: string): method is PaymentMethodId {
  return (PAYMENT_METHOD_IDS as readonly string[]).includes(method);
}
