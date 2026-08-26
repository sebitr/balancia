import "server-only";
import type { Database } from "@/lib/db/client";
import { authorizeGroup, type UserActor } from "@/lib/security/authorization";
import { createExpense } from "@/modules/expenses/service";
import {
  addParticipant,
  createGroup,
  createInvitation,
} from "@/modules/groups/service";
import { createRecurringExpense } from "@/modules/recurring/service";
import { createSettlement } from "@/modules/settlements/service";

/**
 * The workspace a new account is given to look at.
 *
 * One definition, two callers: `scripts/seed.ts` fills a development database
 * with it, and the demo instance builds a private copy of it for every visitor
 * who signs in (see sessions.ts). They used to be the same code by accident;
 * they are the same code on purpose now, so the demo cannot quietly stop
 * showing what a developer is looking at.
 *
 * Everything goes through the ordinary service layer rather than direct
 * inserts, so the rows carry the activity history, balances and derived state
 * that the real flows produce — a demo built from raw inserts looks right on
 * the group screen and empty everywhere else.
 *
 * The two groups exist to show the choice that has no undo: `converted` folds
 * every currency into one at a frozen rate, `separate` keeps each currency
 * balanced on its own.
 */

export interface DemoWorkspace {
  readonly tripGroupId: string;
  readonly flatGroupId: string;
  /** Grace's guest link — shown once, as in the real flow. */
  readonly guestInvitationToken: string;
}

/** A calendar date relative to today, as the "YYYY-MM-DD" the domain uses. */
function today(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

export async function seedDemoWorkspace(
  actor: UserActor,
  options: { db?: Database } = {},
): Promise<DemoWorkspace> {
  const { db } = options;

  // ── Group 1: converted to EUR ──────────────────────────────────────────
  const trip = await createGroup(
    actor,
    {
      name: "Lisbon trip",
      description: "Four days, three people, too much pastry.",
      currencyMode: "converted",
      baseCurrency: "EUR",
      timezone: "Europe/Lisbon",
      ownerDisplayName: actor.name,
    },
    { db },
  );

  const tripAccess = await authorizeGroup(actor, trip.id, { db });
  const blaise = await addParticipant(
    tripAccess,
    { displayName: "Blaise", email: "blaise@example.com" },
    { db },
  );
  const grace = await addParticipant(
    tripAccess,
    { displayName: "Grace", email: "" },
    { db },
  );
  const ada = trip.participantId;

  // Equal split
  await createExpense(
    tripAccess,
    {
      description: "Apartment",
      notes: "",
      category: "lodging",
      amount: "60000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: today(-6),
      payers: [{ participantId: ada, amount: "60000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: ada },
        { participantId: blaise },
        { participantId: grace },
      ],
    },
    { db },
  );

  // Exact amounts
  await createExpense(
    tripAccess,
    {
      description: "Train tickets",
      notes: "Different fares",
      category: "transport",
      amount: "8550",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: today(-5),
      payers: [{ participantId: blaise, amount: "8550" }],
      splitMethod: "exact",
      splitEntries: [
        { participantId: ada, value: "3000" },
        { participantId: blaise, value: "3000" },
        { participantId: grace, value: "2550" },
      ],
    },
    { db },
  );

  // Percentage split
  await createExpense(
    tripAccess,
    {
      description: "Tasting menu",
      notes: "",
      category: "restaurants",
      amount: "12000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: today(-4),
      payers: [{ participantId: grace, amount: "12000" }],
      splitMethod: "percentage",
      splitEntries: [
        { participantId: ada, value: "33.33" },
        { participantId: blaise, value: "33.33" },
        { participantId: grace, value: "33.34" },
      ],
    },
    { db },
  );

  // Share-based split
  await createExpense(
    tripAccess,
    {
      description: "Taxi to the airport",
      notes: "Ada had two suitcases",
      category: "transport",
      amount: "4500",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: today(-3),
      payers: [{ participantId: ada, amount: "4500" }],
      splitMethod: "shares",
      splitEntries: [
        { participantId: ada, value: "2" },
        { participantId: blaise, value: "1" },
        { participantId: grace, value: "1" },
      ],
    },
    { db },
  );

  // Foreign currency, converted at a frozen rate
  await createExpense(
    tripAccess,
    {
      description: "Duty-free perfume",
      notes: "Bought in dollars",
      category: "shopping",
      amount: "11000",
      currency: "USD",
      exchangeRate: "0.92",
      expenseDate: today(-3),
      payers: [{ participantId: blaise, amount: "11000" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: ada }, { participantId: blaise }],
    },
    { db },
  );

  // Multi-payer expense
  await createExpense(
    tripAccess,
    {
      description: "Boat tour",
      notes: "Ada and Grace split the deposit",
      category: "activities",
      amount: "9000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: today(-2),
      payers: [
        { participantId: ada, amount: "6000" },
        { participantId: grace, amount: "3000" },
      ],
      splitMethod: "equal",
      splitEntries: [
        { participantId: ada },
        { participantId: blaise },
        { participantId: grace },
      ],
    },
    { db },
  );

  // Settlement
  await createSettlement(
    tripAccess,
    {
      fromParticipantId: blaise,
      toParticipantId: ada,
      amount: "5000",
      currency: "EUR",
      exchangeRate: "",
      settledOn: today(-1),
      notes: "Partial repayment",
    },
    { db },
  );

  // A guest link for Grace, who has no account.
  const invitation = await createInvitation(
    tripAccess,
    { participantId: grace },
    { db },
  );

  // ── Group 2: separate currencies ───────────────────────────────────────
  const flat = await createGroup(
    actor,
    {
      name: "Flat share",
      description: "Rent, bills and the occasional joint grocery run.",
      currencyMode: "separate",
      timezone: "Europe/Paris",
      ownerDisplayName: actor.name,
    },
    { db },
  );

  const flatAccess = await authorizeGroup(actor, flat.id, { db });
  const katherine = await addParticipant(
    flatAccess,
    { displayName: "Katherine", email: "katherine@example.com" },
    { db },
  );
  const adaFlat = flat.participantId;

  await createExpense(
    flatAccess,
    {
      description: "Electricity",
      notes: "",
      category: "home",
      subcategory: "electricity",
      amount: "8400",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: today(-10),
      payers: [{ participantId: adaFlat, amount: "8400" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: adaFlat }, { participantId: katherine }],
    },
    { db },
  );

  // A second currency in the same group — balanced independently.
  await createExpense(
    flatAccess,
    {
      description: "Souvenir from Tokyo",
      notes: "Recorded in yen; this group keeps currencies apart",
      category: "gifts_donations",
      subcategory: "gifts",
      amount: "9000",
      currency: "JPY",
      exchangeRate: "",
      expenseDate: today(-8),
      payers: [{ participantId: katherine, amount: "9000" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: adaFlat }, { participantId: katherine }],
    },
    { db },
  );

  // Recurring expense: rent, monthly, in the group's timezone.
  await createRecurringExpense(
    flatAccess,
    {
      description: "Rent",
      notes: "",
      category: "home",
      subcategory: "rent",
      amount: "120000",
      currency: "EUR",
      exchangeRate: "",
      payers: [{ participantId: adaFlat, amount: "120000" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: adaFlat }, { participantId: katherine }],
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 1,
      startDate: today(-30),
      endDate: "",
    },
    { db },
  );

  return {
    tripGroupId: trip.id,
    flatGroupId: flat.id,
    guestInvitationToken: invitation.token,
  };
}
