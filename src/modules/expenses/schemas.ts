import { z } from "zod";
import { SUPPORTED_CURRENCY_CODES } from "@/modules/currencies/iso-4217";
import { SPLIT_METHODS } from "./split";

/**
 * Expense and settlement input validation.
 *
 * Amounts cross this boundary as *strings* of minor units, never as JSON
 * numbers — a large expense would otherwise lose precision before it ever
 * reached the money domain.
 */

export const minorUnitsString = z
  .string()
  .trim()
  .regex(/^\d+$/, "Enter a valid amount")
  .refine((value) => BigInt(value) <= 10n ** 18n, "That amount is too large");

export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (value) => SUPPORTED_CURRENCY_CODES.includes(value),
    "Choose a supported currency",
  );

/** ISO calendar date, kept as a string so no timezone shifts it. */
export const isoDateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    "Not a real date",
  );

export const payerSchema = z.object({
  participantId: z.uuid(),
  amount: minorUnitsString,
});

export const splitEntrySchema = z.object({
  participantId: z.uuid(),
  value: z.string().trim().optional(),
});

export const expenseInputSchema = z
  .object({
    description: z.string().trim().min(1, "Describe the expense").max(200),
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
    category: z.string().trim().max(60).optional().or(z.literal("")),
    amount: minorUnitsString,
    currency: currencyCodeSchema,
    /** Required in converted groups when currency differs from the base. */
    exchangeRate: z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/, "Enter a valid exchange rate")
      .optional()
      .or(z.literal("")),
    expenseDate: isoDateSchema,
    payers: z.array(payerSchema).min(1, "Add at least one payer"),
    splitMethod: z.enum(SPLIT_METHODS),
    splitEntries: z
      .array(splitEntrySchema)
      .min(1, "Split between at least one participant"),
    attachmentIds: z.array(z.uuid()).max(10).optional(),
  })
  .refine((value) => BigInt(value.amount) > 0n, {
    path: ["amount"],
    message: "The amount must be greater than zero",
  });

export type ExpenseInput = z.infer<typeof expenseInputSchema>;

export const settlementInputSchema = z
  .object({
    fromParticipantId: z.uuid(),
    toParticipantId: z.uuid(),
    amount: minorUnitsString,
    currency: currencyCodeSchema,
    exchangeRate: z
      .string()
      .trim()
      .regex(/^\d+(\.\d+)?$/, "Enter a valid exchange rate")
      .optional()
      .or(z.literal("")),
    settledOn: isoDateSchema,
    notes: z.string().trim().max(2000).optional().or(z.literal("")),
  })
  .refine((value) => value.fromParticipantId !== value.toParticipantId, {
    path: ["toParticipantId"],
    message: "Choose two different people",
  })
  .refine((value) => BigInt(value.amount) > 0n, {
    path: ["amount"],
    message: "The amount must be greater than zero",
  });

export type SettlementInput = z.infer<typeof settlementInputSchema>;
