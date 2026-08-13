import { z } from "zod";
import { SUPPORTED_CURRENCY_CODES } from "@/modules/currencies/iso-4217";
import { CURRENCY_MODES } from "@/modules/currencies/conversion";

/**
 * Input validation for group and participant operations.
 *
 * These schemas are the boundary between untrusted input and domain services:
 * every Server Action and route handler parses with one of them first.
 */

const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    (value) => SUPPORTED_CURRENCY_CODES.includes(value),
    "Choose a supported ISO 4217 currency",
  );

/** Validates against the runtime's own timezone database rather than a list. */
const timezone = z
  .string()
  .trim()
  .min(1, "Choose a timezone")
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Not a recognised IANA timezone");

export const createGroupSchema = z
  .object({
    name: z.string().trim().min(1, "Give the group a name").max(120),
    description: z.string().trim().max(2000).optional().or(z.literal("")),
    currencyMode: z.enum(CURRENCY_MODES),
    baseCurrency: currencyCode.optional(),
    timezone,
    /** The creator's own display name inside this group. */
    ownerDisplayName: z.string().trim().min(1, "Enter your name").max(120),
    /**
     * Other people to create with the group. They get no account — a group
     * organiser should not have to recruit everyone before recording a bill.
     *
     * Optional, so every existing caller stays valid. The cap is an input
     * bound to keep one request from writing unbounded rows; there is no limit
     * on how many people a group may hold, and more can be added afterwards.
     */
    participantNames: z
      .array(z.string().trim().min(1, "Enter a name").max(120))
      .max(50, "Add up to 50 people here — you can add more afterwards")
      .optional(),
  })
  .refine(
    (value) =>
      value.currencyMode !== "converted" || Boolean(value.baseCurrency),
    {
      path: ["baseCurrency"],
      message: "A converted group needs a base currency",
    },
  );

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  timezone,
});

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

export const addParticipantSchema = z.object({
  displayName: z.string().trim().min(1, "Enter a name").max(120),
  email: z
    .string()
    .trim()
    .email("Enter a valid email address")
    .optional()
    .or(z.literal("")),
});

export type AddParticipantInput = z.infer<typeof addParticipantSchema>;

export const updateParticipantSchema = addParticipantSchema.extend({
  participantId: z.uuid(),
});

export const createInvitationSchema = z.object({
  participantId: z.uuid(),
  /** Optional expiry, in days from now. */
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
