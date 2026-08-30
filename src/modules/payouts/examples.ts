import type {
  PaymentMethodId,
  SupportedCountry,
} from "@/modules/settlements/payment-methods";
import { payoutFieldFor } from "./fields";

/**
 * What a filled-in payout field looks like, in the country the method is from.
 *
 * A greyed example is read as an instruction — it is the only thing in an
 * empty field that says what shape the answer has. So a Swiss number under
 * Satispay is not a harmless stand-in: Satispay is Italian, nobody paying by
 * it has a +41 number, and the field quietly describes somebody else's
 * country. The same example then reappears in the complaint when a number is
 * refused, which is the moment it is read most closely.
 *
 * Which country an example belongs to comes from the *method* wherever the
 * method has one, because almost every scheme here is national — TWINT is
 * Swiss, Bizum Spanish, BLIK Polish. The two cases that have no country of
 * their own take the reader's, detected from their timezone:
 *
 *  - a bank transfer, which is every country at once, and
 *  - the handful of methods that run in several — Wero across France, Germany
 *    and Belgium, MobilePay in Denmark and Finland.
 *
 * Only `phone` and `iban` details are country-shaped. A Revtag, an email
 * address and a PayPal.me link look the same everywhere, so those keep the
 * translated placeholder from `messages/*.json` and never reach this file.
 */

/**
 * The country an example falls back to when nothing better is known.
 *
 * Switzerland, which is where this application and its first users are, and
 * which is the country the IBAN field has always shown.
 */
const DEFAULT_COUNTRY: SupportedCountry = "CH";

/**
 * One example mobile number per country, spaced exactly as the field will
 * space it while it is being typed.
 *
 * These are libphonenumber's own example numbers, which is what makes them
 * safe to print: they are drawn from the ranges each regulator sets aside for
 * fiction and documentation, so nobody's phone is being advertised here.
 * Switzerland is the exception and keeps the number this app has always shown.
 *
 * `examples.test.ts` holds both halves of the promise — every one of these is
 * a valid mobile number for its country, and every one is already written the
 * way `AsYouType` would write it, so the example does not reshape itself the
 * moment somebody starts typing over it. That guard is why the table is
 * exported; nothing outside the test reads it directly.
 */
export const PHONE_BY_COUNTRY = {
  AT: "+43 664 123456",
  AU: "+61 412 345 678",
  BE: "+32 450 00 12 34",
  BR: "+55 11 96123 4567",
  CA: "+1 506 234 5678",
  CH: "+41 79 123 45 67",
  DE: "+49 1512 3456789",
  DK: "+45 34 41 23 45",
  ES: "+34 612 34 56 78",
  FI: "+358 41 2345678",
  FR: "+33 6 12 34 56 78",
  GB: "+44 7400 123456",
  IE: "+353 85 012 3456",
  IN: "+91 81234 56789",
  IT: "+39 312 345 6789",
  NL: "+31 6 12345678",
  NO: "+47 40 61 23 45",
  PL: "+48 512 345 678",
  PT: "+351 912 345 678",
  SE: "+46 70 123 45 67",
  US: "+1 201 555 0123",
} as const satisfies Record<SupportedCountry, string>;

/**
 * One example IBAN per country that has them, in groups of four.
 *
 * The published examples from the IBAN registry, so the length and the bank
 * code shape are a country's real ones rather than a plausible-looking string
 * — an example a Portuguese reader can measure their own against is the whole
 * point of showing one.
 *
 * Four countries are missing on purpose: the United States, Canada, India and
 * Australia do not use IBANs at all, and there is nothing to show somebody
 * there. They fall back to the Swiss example, which at least says what the
 * field will accept — this one field takes an IBAN and refuses everything
 * else, whoever is reading it.
 *
 * `examples.test.ts` runs each of these through the app's own checker, so a
 * transposed digit here fails the build rather than teaching somebody to type
 * an IBAN that cannot be paid.
 */
const SWISS_IBAN = "CH93 0076 2011 6238 5295 7";

export const IBAN_BY_COUNTRY: Partial<Record<SupportedCountry, string>> = {
  AT: "AT61 1904 3002 3457 3201",
  BE: "BE68 5390 0754 7034",
  BR: "BR97 0036 0305 0000 1000 9795 493P1",
  CH: SWISS_IBAN,
  DE: "DE89 3704 0044 0532 0130 00",
  DK: "DK50 0040 0440 1162 43",
  ES: "ES91 2100 0418 4502 0005 1332",
  FI: "FI21 1234 5600 0007 85",
  FR: "FR14 2004 1010 0505 0001 3M02 606",
  GB: "GB29 NWBK 6016 1331 9268 19",
  IE: "IE29 AIBK 9311 5212 3456 78",
  IT: "IT60 X054 2811 1010 0000 0123 456",
  NL: "NL91 ABNA 0417 1643 00",
  NO: "NO93 8601 1117 947",
  PL: "PL61 1090 1014 0000 0712 1981 2874",
  PT: "PT50 0002 0123 1234 5678 9015 4",
  SE: "SE45 5000 0000 0583 9825 7466",
};

/**
 * Where each method's details are written, most likely first.
 *
 * A method absent from here has no country of its own — a bank transfer, a
 * Revtag — and takes the reader's. A method that runs in several countries
 * lists them all: the reader's own is used when it is one of them, and the
 * first otherwise, which is why the lists are ordered by where the scheme is
 * actually used rather than alphabetically.
 *
 * N26 is a German bank and hands out a DE IBAN by default. It issues local
 * ones in some of its markets now, which is why the example is only an
 * example — the field takes any IBAN that checks out.
 */
const COUNTRIES_BY_METHOD: Partial<
  Record<PaymentMethodId, readonly SupportedCountry[]>
> = {
  bancomat_pay: ["IT"],
  bizum: ["ES"],
  blik: ["PL"],
  lydia: ["FR"],
  mbway: ["PT"],
  mobilepay: ["DK", "FI"],
  n26: ["DE"],
  payconiq: ["BE"],
  satispay: ["IT"],
  swish: ["SE"],
  tikkie: ["NL"],
  twint: ["CH"],
  vipps: ["NO"],
  wero: ["FR", "DE", "BE"],
};

/**
 * The country a method's details are written in for this reader.
 *
 * Null only when neither the method nor the reader says anything — a bank
 * transfer on a phone whose timezone we have no opinion about.
 */
export function countryForPayoutMethod(
  method: string,
  viewer: SupportedCountry | null,
): SupportedCountry | null {
  const countries = COUNTRIES_BY_METHOD[method as PaymentMethodId];
  if (!countries) return viewer;
  if (viewer && countries.includes(viewer)) return viewer;
  return countries[0];
}

/**
 * The example number a phone field shows.
 *
 * Its own function, and never null, because the complaint about a number
 * missing its country code names it too — and that is the moment the example
 * is read most closely, so it had better be the same one the field was
 * showing a second ago.
 */
export function phoneExampleFor(
  method: string,
  viewer: SupportedCountry | null,
): string {
  return PHONE_BY_COUNTRY[
    countryForPayoutMethod(method, viewer) ?? DEFAULT_COUNTRY
  ];
}

/**
 * The example to show in a method's empty field, or null when the shape of
 * the answer is the same everywhere and the catalogue already has the words.
 */
export function payoutExampleFor(
  method: string,
  viewer: SupportedCountry | null,
): string | null {
  switch (payoutFieldFor(method)) {
    case "phone":
      return phoneExampleFor(method, viewer);
    case "iban": {
      const country = countryForPayoutMethod(method, viewer) ?? DEFAULT_COUNTRY;
      return IBAN_BY_COUNTRY[country] ?? SWISS_IBAN;
    }
    default:
      return null;
  }
}
