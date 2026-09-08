import { z } from "zod";
import { REMIND_MESSAGE_MAX_LENGTH } from "./types";

/**
 * Reminder input validation.
 *
 * The action that takes this used to declare its parameter as a typed object
 * and parse nothing — a promise the compiler keeps and the runtime does not.
 * A Server Action is a public endpoint, and what arrives is whatever the
 * caller posted.
 *
 * `toParticipantId` was never the exposure: `sendReminder` rebuilds the
 * recipient list from the balances and matches against that, so a forged id
 * reminds nobody. `message` was, and it goes to the `notifications` payload
 * column — a text field with no ceiling is one somebody eventually posts a
 * megabyte into, once per recipient per day.
 */
export const reminderInputSchema = z.object({
  toParticipantId: z.uuid(),
  message: z.string().trim().min(1).max(REMIND_MESSAGE_MAX_LENGTH),
  logToActivity: z.boolean(),
});
