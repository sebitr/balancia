import type { SwissCreditorAddress } from "./qr/swiss";

/**
 * What a creditor's postal address has to be before it is worth writing.
 *
 * Four predicates, and the reason they are a module rather than four closures
 * next to one form: two screens now ask these questions — the settings card at
 * `/settings/payouts` and the sheet the onboarding and settle-up flows share —
 * and the answers must not drift. A second, slightly looser `isCompleteAddress`
 * is how a screen starts accepting an address the server then refuses, and the
 * owner finds out when a QR code they cannot see fails to appear.
 *
 * They are here rather than beside a component because none of them renders
 * anything, and the server's own schema in `payouts/actions.ts` is checking
 * the same three fields.
 */

/** What "no address" looks like in the fields; the account holds null. */
export const EMPTY_ADDRESS: SwissCreditorAddress = {
  street: "",
  buildingNumber: "",
  postalCode: "",
  town: "",
  country: "",
};

export const ADDRESS_FIELDS = [
  "street",
  "buildingNumber",
  "postalCode",
  "town",
  "country",
] as const;

/**
 * Whether an address is needed at all.
 *
 * Only the Swiss standard requires one, so only a Swiss IBAN is asked. A
 * German account gets a Girocode, which carries no address, and nobody is
 * asked where they live to be paid by TWINT.
 */
export function isSwissIban(detail: string): boolean {
  return /^(CH|LI)/i.test(detail.replace(/\s/g, ""));
}

/**
 * The three the standard will not build a code without.
 *
 * The country is two letters, not a country: ISO 3166-1 alpha-2 is what
 * travels in the code, and it is what `setPayoutAddressAction` accepts.
 */
export function isCompleteAddress(address: SwissCreditorAddress): boolean {
  return (
    address.postalCode.trim().length > 0 &&
    address.town.trim().length > 0 &&
    /^[A-Za-z]{2}$/.test(address.country.trim())
  );
}

export function isBlankAddress(address: SwissCreditorAddress): boolean {
  return ADDRESS_FIELDS.every((key) => (address[key] ?? "").trim() === "");
}

export function sameAddress(
  address: SwissCreditorAddress,
  saved: SwissCreditorAddress | null,
): boolean {
  if (!saved) return false;
  return ADDRESS_FIELDS.every(
    (key) => (address[key] ?? "").trim() === (saved[key] ?? "").trim(),
  );
}
