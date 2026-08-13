import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Enums shared by more than one schema module.
 *
 * They live apart from the tables because `expenses` and `recurring_expenses`
 * reference each other: keeping the enums here means neither module has to be
 * evaluated before the other.
 */

export const currencyModeEnum = pgEnum("currency_mode", [
  "separate",
  "converted",
]);

export const groupRoleEnum = pgEnum("group_role", ["owner", "member"]);

export const splitMethodEnum = pgEnum("split_method", [
  "equal",
  "exact",
  "percentage",
  "shares",
]);

export const exchangeRateSourceEnum = pgEnum("exchange_rate_source", [
  "manual",
  "import",
  "api",
]);

export const actorTypeEnum = pgEnum("actor_type", ["user", "guest", "system"]);

export const recurrenceFrequencyEnum = pgEnum("recurrence_frequency", [
  "weekly",
  "monthly",
  "yearly",
]);
