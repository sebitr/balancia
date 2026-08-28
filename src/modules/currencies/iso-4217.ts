/**
 * ISO 4217 currency data restricted to what Balancia needs: the code and the
 * number of minor-unit digits (the "exponent"). Amounts are always stored as
 * integer minor units, so the exponent is what turns 1050 into "10.50" — or,
 * for JPY, 1050 into "1,050", and for BHD, 1050 into "1.050".
 *
 * The list covers active ISO 4217 codes with exponents 0, 2 and 3. Codes with
 * no minor unit at all (XAU and friends) and funds codes are intentionally
 * excluded — they are not useful for splitting a dinner bill.
 */

export interface CurrencyDefinition {
  readonly code: string;
  /** Number of decimal digits in the minor unit (0, 2 or 3). */
  readonly exponent: number;
  readonly name: string;
}

const DEFINITIONS: readonly CurrencyDefinition[] = [
  { code: "AED", exponent: 2, name: "UAE Dirham" },
  { code: "AFN", exponent: 2, name: "Afghani" },
  { code: "ALL", exponent: 2, name: "Lek" },
  { code: "AMD", exponent: 2, name: "Armenian Dram" },
  { code: "ANG", exponent: 2, name: "Netherlands Antillean Guilder" },
  { code: "AOA", exponent: 2, name: "Kwanza" },
  { code: "ARS", exponent: 2, name: "Argentine Peso" },
  { code: "AUD", exponent: 2, name: "Australian Dollar" },
  { code: "AWG", exponent: 2, name: "Aruban Florin" },
  { code: "AZN", exponent: 2, name: "Azerbaijan Manat" },
  { code: "BAM", exponent: 2, name: "Convertible Mark" },
  { code: "BBD", exponent: 2, name: "Barbados Dollar" },
  { code: "BDT", exponent: 2, name: "Taka" },
  { code: "BGN", exponent: 2, name: "Bulgarian Lev" },
  { code: "BHD", exponent: 3, name: "Bahraini Dinar" },
  { code: "BIF", exponent: 0, name: "Burundi Franc" },
  { code: "BMD", exponent: 2, name: "Bermudian Dollar" },
  { code: "BND", exponent: 2, name: "Brunei Dollar" },
  { code: "BOB", exponent: 2, name: "Boliviano" },
  { code: "BRL", exponent: 2, name: "Brazilian Real" },
  { code: "BSD", exponent: 2, name: "Bahamian Dollar" },
  { code: "BTN", exponent: 2, name: "Ngultrum" },
  { code: "BWP", exponent: 2, name: "Pula" },
  { code: "BYN", exponent: 2, name: "Belarusian Ruble" },
  { code: "BZD", exponent: 2, name: "Belize Dollar" },
  { code: "CAD", exponent: 2, name: "Canadian Dollar" },
  { code: "CDF", exponent: 2, name: "Congolese Franc" },
  { code: "CHF", exponent: 2, name: "Swiss Franc" },
  { code: "CLP", exponent: 0, name: "Chilean Peso" },
  { code: "CNY", exponent: 2, name: "Yuan Renminbi" },
  { code: "COP", exponent: 2, name: "Colombian Peso" },
  { code: "CRC", exponent: 2, name: "Costa Rican Colon" },
  { code: "CUP", exponent: 2, name: "Cuban Peso" },
  { code: "CVE", exponent: 2, name: "Cabo Verde Escudo" },
  { code: "CZK", exponent: 2, name: "Czech Koruna" },
  { code: "DJF", exponent: 0, name: "Djibouti Franc" },
  { code: "DKK", exponent: 2, name: "Danish Krone" },
  { code: "DOP", exponent: 2, name: "Dominican Peso" },
  { code: "DZD", exponent: 2, name: "Algerian Dinar" },
  { code: "EGP", exponent: 2, name: "Egyptian Pound" },
  { code: "ERN", exponent: 2, name: "Nakfa" },
  { code: "ETB", exponent: 2, name: "Ethiopian Birr" },
  { code: "EUR", exponent: 2, name: "Euro" },
  { code: "FJD", exponent: 2, name: "Fiji Dollar" },
  { code: "FKP", exponent: 2, name: "Falkland Islands Pound" },
  { code: "GBP", exponent: 2, name: "Pound Sterling" },
  { code: "GEL", exponent: 2, name: "Lari" },
  { code: "GHS", exponent: 2, name: "Ghana Cedi" },
  { code: "GIP", exponent: 2, name: "Gibraltar Pound" },
  { code: "GMD", exponent: 2, name: "Dalasi" },
  { code: "GNF", exponent: 0, name: "Guinean Franc" },
  { code: "GTQ", exponent: 2, name: "Quetzal" },
  { code: "GYD", exponent: 2, name: "Guyana Dollar" },
  { code: "HKD", exponent: 2, name: "Hong Kong Dollar" },
  { code: "HNL", exponent: 2, name: "Lempira" },
  { code: "HTG", exponent: 2, name: "Gourde" },
  { code: "HUF", exponent: 2, name: "Forint" },
  { code: "IDR", exponent: 2, name: "Rupiah" },
  { code: "ILS", exponent: 2, name: "New Israeli Sheqel" },
  { code: "INR", exponent: 2, name: "Indian Rupee" },
  { code: "IQD", exponent: 3, name: "Iraqi Dinar" },
  { code: "IRR", exponent: 2, name: "Iranian Rial" },
  { code: "ISK", exponent: 0, name: "Iceland Krona" },
  { code: "JMD", exponent: 2, name: "Jamaican Dollar" },
  { code: "JOD", exponent: 3, name: "Jordanian Dinar" },
  { code: "JPY", exponent: 0, name: "Yen" },
  { code: "KES", exponent: 2, name: "Kenyan Shilling" },
  { code: "KGS", exponent: 2, name: "Som" },
  { code: "KHR", exponent: 2, name: "Riel" },
  { code: "KMF", exponent: 0, name: "Comorian Franc" },
  { code: "KPW", exponent: 2, name: "North Korean Won" },
  { code: "KRW", exponent: 0, name: "Won" },
  { code: "KWD", exponent: 3, name: "Kuwaiti Dinar" },
  { code: "KYD", exponent: 2, name: "Cayman Islands Dollar" },
  { code: "KZT", exponent: 2, name: "Tenge" },
  { code: "LAK", exponent: 2, name: "Lao Kip" },
  { code: "LBP", exponent: 2, name: "Lebanese Pound" },
  { code: "LKR", exponent: 2, name: "Sri Lanka Rupee" },
  { code: "LRD", exponent: 2, name: "Liberian Dollar" },
  { code: "LSL", exponent: 2, name: "Loti" },
  { code: "LYD", exponent: 3, name: "Libyan Dinar" },
  { code: "MAD", exponent: 2, name: "Moroccan Dirham" },
  { code: "MDL", exponent: 2, name: "Moldovan Leu" },
  { code: "MGA", exponent: 2, name: "Malagasy Ariary" },
  { code: "MKD", exponent: 2, name: "Denar" },
  { code: "MMK", exponent: 2, name: "Kyat" },
  { code: "MNT", exponent: 2, name: "Tugrik" },
  { code: "MOP", exponent: 2, name: "Pataca" },
  { code: "MRU", exponent: 2, name: "Ouguiya" },
  { code: "MUR", exponent: 2, name: "Mauritius Rupee" },
  { code: "MVR", exponent: 2, name: "Rufiyaa" },
  { code: "MWK", exponent: 2, name: "Malawi Kwacha" },
  { code: "MXN", exponent: 2, name: "Mexican Peso" },
  { code: "MYR", exponent: 2, name: "Malaysian Ringgit" },
  { code: "MZN", exponent: 2, name: "Mozambique Metical" },
  { code: "NAD", exponent: 2, name: "Namibia Dollar" },
  { code: "NGN", exponent: 2, name: "Naira" },
  { code: "NIO", exponent: 2, name: "Cordoba Oro" },
  { code: "NOK", exponent: 2, name: "Norwegian Krone" },
  { code: "NPR", exponent: 2, name: "Nepalese Rupee" },
  { code: "NZD", exponent: 2, name: "New Zealand Dollar" },
  { code: "OMR", exponent: 3, name: "Rial Omani" },
  { code: "PAB", exponent: 2, name: "Balboa" },
  { code: "PEN", exponent: 2, name: "Sol" },
  { code: "PGK", exponent: 2, name: "Kina" },
  { code: "PHP", exponent: 2, name: "Philippine Peso" },
  { code: "PKR", exponent: 2, name: "Pakistan Rupee" },
  { code: "PLN", exponent: 2, name: "Zloty" },
  { code: "PYG", exponent: 0, name: "Guarani" },
  { code: "QAR", exponent: 2, name: "Qatari Rial" },
  { code: "RON", exponent: 2, name: "Romanian Leu" },
  { code: "RSD", exponent: 2, name: "Serbian Dinar" },
  { code: "RUB", exponent: 2, name: "Russian Ruble" },
  { code: "RWF", exponent: 0, name: "Rwanda Franc" },
  { code: "SAR", exponent: 2, name: "Saudi Riyal" },
  { code: "SBD", exponent: 2, name: "Solomon Islands Dollar" },
  { code: "SCR", exponent: 2, name: "Seychelles Rupee" },
  { code: "SDG", exponent: 2, name: "Sudanese Pound" },
  { code: "SEK", exponent: 2, name: "Swedish Krona" },
  { code: "SGD", exponent: 2, name: "Singapore Dollar" },
  { code: "SHP", exponent: 2, name: "Saint Helena Pound" },
  { code: "SLE", exponent: 2, name: "Leone" },
  { code: "SOS", exponent: 2, name: "Somali Shilling" },
  { code: "SRD", exponent: 2, name: "Surinam Dollar" },
  { code: "SSP", exponent: 2, name: "South Sudanese Pound" },
  { code: "STN", exponent: 2, name: "Dobra" },
  { code: "SVC", exponent: 2, name: "El Salvador Colon" },
  { code: "SYP", exponent: 2, name: "Syrian Pound" },
  { code: "SZL", exponent: 2, name: "Lilangeni" },
  { code: "THB", exponent: 2, name: "Baht" },
  { code: "TJS", exponent: 2, name: "Somoni" },
  { code: "TMT", exponent: 2, name: "Turkmenistan New Manat" },
  { code: "TND", exponent: 3, name: "Tunisian Dinar" },
  { code: "TOP", exponent: 2, name: "Pa’anga" },
  { code: "TRY", exponent: 2, name: "Turkish Lira" },
  { code: "TTD", exponent: 2, name: "Trinidad and Tobago Dollar" },
  { code: "TWD", exponent: 2, name: "New Taiwan Dollar" },
  { code: "TZS", exponent: 2, name: "Tanzanian Shilling" },
  { code: "UAH", exponent: 2, name: "Hryvnia" },
  { code: "UGX", exponent: 0, name: "Uganda Shilling" },
  { code: "USD", exponent: 2, name: "US Dollar" },
  { code: "UYU", exponent: 2, name: "Peso Uruguayo" },
  { code: "UZS", exponent: 2, name: "Uzbekistan Sum" },
  { code: "VED", exponent: 2, name: "Bolívar Soberano" },
  { code: "VND", exponent: 0, name: "Dong" },
  { code: "VUV", exponent: 0, name: "Vatu" },
  { code: "WST", exponent: 2, name: "Tala" },
  { code: "XAF", exponent: 0, name: "CFA Franc BEAC" },
  { code: "XCD", exponent: 2, name: "East Caribbean Dollar" },
  { code: "XCG", exponent: 2, name: "Caribbean Guilder" },
  { code: "XOF", exponent: 0, name: "CFA Franc BCEAO" },
  { code: "XPF", exponent: 0, name: "CFP Franc" },
  { code: "YER", exponent: 2, name: "Yemeni Rial" },
  { code: "ZAR", exponent: 2, name: "Rand" },
  { code: "ZMW", exponent: 2, name: "Zambian Kwacha" },
  { code: "ZWG", exponent: 2, name: "Zimbabwe Gold" },
];

const BY_CODE: ReadonlyMap<string, CurrencyDefinition> = new Map(
  DEFINITIONS.map((definition) => [definition.code, definition]),
);

export const SUPPORTED_CURRENCIES = DEFINITIONS;

export const SUPPORTED_CURRENCY_CODES: readonly string[] = DEFINITIONS.map(
  (definition) => definition.code,
);

export function isSupportedCurrency(code: string): boolean {
  return BY_CODE.has(code);
}

export class UnknownCurrencyError extends Error {
  constructor(readonly code: string) {
    super(`Unknown or unsupported ISO 4217 currency code: ${code}`);
    this.name = "UnknownCurrencyError";
  }
}

export function getCurrency(code: string): CurrencyDefinition {
  const definition = BY_CODE.get(code);
  if (!definition) {
    throw new UnknownCurrencyError(code);
  }
  return definition;
}

/** Number of minor-unit digits for a currency, e.g. 2 for EUR, 0 for JPY. */
export function currencyExponent(code: string): number {
  return getCurrency(code).exponent;
}

/** 10 ** exponent, as a bigint — the number of minor units in one major unit. */
export function minorUnitsPerMajor(code: string): bigint {
  return 10n ** BigInt(currencyExponent(code));
}
