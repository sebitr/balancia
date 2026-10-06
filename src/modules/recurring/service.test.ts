import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/client";
import type { GroupAccess } from "@/lib/security/authorization";
import { RecurrenceError } from "./schedule";
import { createRecurringExpense, recurringInputSchema } from "./service";

/**
 * A rule that ends before its first date, refused in words.
 *
 * The table refuses an end before the start outright, and that used to reach
 * the reader as a failed write with no reason given. The refusal comes before
 * anything is read or written, which is why a group's access and no database
 * are all this needs.
 */

const PERSON = "8d0f6a0e-6f4a-4c55-9a52-3d1f3c1b2a01";

const ACCESS = {
  permissions: { manageRecurring: true },
  group: { timezone: "Europe/Zurich" },
} as unknown as GroupAccess;

/** A database nothing may touch: the refusal has to come first. */
const UNTOUCHED = new Proxy(
  {},
  {
    get() {
      throw new Error("the database was reached");
    },
  },
) as Database;

function rent(dates: { startDate: string; endDate: string }) {
  return recurringInputSchema.parse({
    description: "Rent",
    amount: "90000",
    currency: "EUR",
    payers: [{ participantId: PERSON, amount: "90000" }],
    splitMethod: "equal",
    splitEntries: [{ participantId: PERSON }],
    frequency: "monthly",
    dayOfMonth: 31,
    ...dates,
  });
}

describe("a recurring expense that ends before its first date", () => {
  it.each([
    ["before its start", { startDate: "2026-10-06", endDate: "2026-10-01" }],
    // The start is the 6th and the rule is on the 31st: the 20th is after
    // the start and still before the first date.
    ["before its first date", { startDate: "2026-10-06", endDate: "2026-10-20" }],
  ])("is refused when it ends %s", async (_, dates) => {
    const refusal = createRecurringExpense(ACCESS, rent(dates), {
      db: UNTOUCHED,
    });

    await expect(refusal).rejects.toBeInstanceOf(RecurrenceError);
    await expect(refusal).rejects.toMatchObject({
      message: "The end date is before the first one.",
      code: "endsBeforeFirst",
    });
  });
});
