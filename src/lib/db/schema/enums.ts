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

/**
 * `daily` is last because Postgres orders an enum by the order its labels were
 * added, and appending is the only change that needs no rewrite of the type.
 * Nothing sorts by this column, so the order is a migration concern only.
 */
export const recurrenceFrequencyEnum = pgEnum("recurrence_frequency", [
  "weekly",
  "monthly",
  "yearly",
  "daily",
]);

/**
 * Which way the money moved.
 *
 * `out` is spending — somebody paid, the group owes them back. `in` is money
 * received on the group's behalf — rent, a shared refund, a deposit returned —
 * where the receiver owes the others their share instead.
 *
 * Both live in `expenses` because they are the same shape: an amount, payers,
 * and a split. Only the sign differs, and the balance engine applies it. A
 * separate table would have bought nothing but a duplicate of every read path.
 */
export const entryDirectionEnum = pgEnum("entry_direction", ["out", "in"]);
