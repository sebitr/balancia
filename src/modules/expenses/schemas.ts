import Decimal from "decimal.js";
import { z } from "zod";
import {
  isCalendarDate,
  isInCalendarRange,
  MAX_CALENDAR_YEAR,
  MIN_CALENDAR_YEAR,
} from "@/lib/calendar-date";
import {
  isCategoryOfOppositeDirection,
  isValidSubcategoryFor,
} from "@/modules/categorization";
import { MAX_EXCHANGE_RATE } from "@/modules/currencies/conversion";
import { SUPPORTED_CURRENCY_CODES } from "@/modules/currencies/iso-4217";
import { MAX_MINOR_UNITS } from "@/modules/currencies/money";
import { PAYMENT_METHOD_MAX_LENGTH } from "@/modules/settlements/payment-methods";
import { ENTRY_DIRECTIONS } from "./direction";
import { SPLIT_METHODS } from "./split";

/**
 * Expense and settlement input validation.
 *
 * Amounts cross this boundary as *strings* of minor units, never as JSON
 * numbers — a large expense would otherwise lose precision before it ever
 * reached the money domain.
 */

const DIGITS = /^\d+$/;

/**
 * Whether a string of minor units is above zero — and true for one that is not
 * digits at all, which the field's own check has already refused.
 *
 * zod carries on through the refinements after a failed `regex`, and so do the
 * object-level ones below, so `BigInt` is handed whatever was sent. `"abc"`
 * made it throw, the throw escaped `safeParse`, and a malformed amount answered
 * 500 where it should have been told to enter one.
 */
export function isPositiveMinorUnits(value: string): boolean {
  const trimmed = value.trim();
  return !DIGITS.test(trimmed) || BigInt(trimmed) > 0n;
}

export const minorUnitsString = z
  .string()
  .trim()
  .regex(DIGITS, "Enter a valid amount")
  .refine(
    (value) => !DIGITS.test(value) || BigInt(value) <= MAX_MINOR_UNITS,
    "That amount is too large",
  );

const RATE = /^\d+(\.\d+)?$/;

/**
 * An exchange rate as typed: a plain positive decimal, and no larger than a
 * conversion will apply. The ceiling is checked here as well as in
 * `parseExchangeRate` because a recurring template stores its rate without
 * converting anything — refused only when the first occurrence came due, a
 * rate with stray zeros would have failed every morning instead of once, at
 * the form.
 */
export const exchangeRateSchema = z
  .string()
  .trim()
  .regex(RATE, "Enter a valid exchange rate")
  .refine(
    (value) =>
      !RATE.test(value) || !new Decimal(value).greaterThan(MAX_EXCHANGE_RATE),
    "That exchange rate is too large",
  )
  .optional()
  .or(z.literal(""));

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (value) => SUPPORTED_CURRENCY_CODES.includes(value),
    "Choose a supported currency",
  );

/**
 * ISO calendar date, kept as a string so no timezone shifts it.
 *
 * A day the calendar actually has, inside the years Balancia accepts — see
 * `lib/calendar-date.ts` for why the shape was never enough on its own.
 */
export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine(isCalendarDate, "Not a real date")
  .refine(
    (value) => !isCalendarDate(value) || isInCalendarRange(value),
    `Choose a date between ${MIN_CALENDAR_YEAR} and ${MAX_CALENDAR_YEAR}`,
  );

export const payerSchema = z.object({
  participantId: z.uuid(),
  amount: minorUnitsString,
});

/**
 * The longest split value accepted, in characters.
 *
 * Far more than any share, percentage or exact amount anybody types. The
 * allocator scales every weight by one shared power of ten to work in whole
 * numbers, so a single value with ten thousand decimal places would make every
 * share in the split ten thousand digits long; this keeps them to a few dozen.
 */
export const SPLIT_VALUE_MAX_LENGTH = 40;

export const splitEntrySchema = z.object({
  participantId: z.uuid(),
  value: z
    .string()
    .trim()
    .max(SPLIT_VALUE_MAX_LENGTH, "That split value is too long")
    .optional(),
});

export const expenseInputSchema = z
  .object({
    /** Absent means spending, which is what every caller meant before income. */
    direction: z.enum(ENTRY_DIRECTIONS).optional(),
    description: z.string().trim().min(1, "Describe the expense").max(200),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
    /**
     * A canonical category code — or free text, still.
     *
     * Not narrowed to `ExpenseCategory` on purpose. An import writes the
     * source's own label when nothing recognised it ("Fournitures ménagères",
     * "Bus/train"), the spread gives that label its own bucket, and the edit
     * form offers it back as a selectable value. Rejecting it here would make
     * every imported expense unsavable the first time somebody touched its
     * amount. See `categorizeImportedExpense`.
     */
    category: z.string().trim().max(60).optional().or(z.literal("")),
    /**
     * Optional, and only meaningful against a canonical category — the pair
     * is checked below.
     */
    subcategory: z.string().trim().max(60).optional().or(z.literal("")),
    amount: minorUnitsString,
    currency: currencyCodeSchema,
    /** Required in converted groups when currency differs from the base. */
    exchangeRate: exchangeRateSchema,
    expenseDate: isoDateSchema,
    payers: z.array(payerSchema).min(1, "Add at least one payer"),
    splitMethod: z.enum(SPLIT_METHODS),
    splitEntries: z
      .array(splitEntrySchema)
      .min(1, "Split between at least one participant"),
    attachmentIds: z.array(z.uuid()).max(10).optional(),
  })
  .refine((value) => isPositiveMinorUnits(value.amount), {
    path: ["amount"],
    message: "The amount must be greater than zero",
  })
  /**
   * The pair has to agree.
   *
   * `restaurants` + `fuel` is refused, and so is a subcategory hung on free
   * text: an imported label is not a category, so nothing can legitimately sit
   * under it. The form clears the child whenever the parent changes, but a
   * form is a convenience — this is the boundary the API, the importers and
   * the recurring generator all cross.
   */
  .refine(
    (value) =>
      isValidSubcategoryFor(value.direction, value.category, value.subcategory),
    {
      path: ["subcategory"],
      message: "That subcategory does not belong to the chosen category",
    },
  )
  /**
   * And the category has to belong to the direction.
   *
   * Two vocabularies share this column, told apart by `direction`, so
   * `groceries` on an income is not merely unrecognised — it is a code that
   * means something, and something wrong. Free text still passes: an import
   * writes labels no vocabulary has ever heard of, and that is a supported
   * outcome. See `isCategoryOfOppositeDirection`.
   */
  .refine(
    (value) => !isCategoryOfOppositeDirection(value.direction, value.category),
    {
      path: ["category"],
      message: "That category belongs to the other kind of entry",
    },
  );

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const settlementInputSchema = z
  .object({
    fromParticipantId: z.uuid(),
    toParticipantId: z.uuid(),
    amount: minorUnitsString,
    currency: currencyCodeSchema,
    exchangeRate: exchangeRateSchema,
    settledOn: isoDateSchema,
    /**
     * How the money moved. Free text, because the picker's list is a
     * convenience and not a closed world — see the column comment.
     */
    paymentMethod: z
      .string()
      .trim()
      .max(PAYMENT_METHOD_MAX_LENGTH)
      .optional()
      .or(z.literal("")),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine((value) => value.fromParticipantId !== value.toParticipantId, {
    path: ["toParticipantId"],
    message: "Choose two different people",
  })
  .refine((value) => isPositiveMinorUnits(value.amount), {
    path: ["amount"],
    message: "The amount must be greater than zero",
  });

export type SettlementInput = z.infer<typeof settlementInputSchema>;
