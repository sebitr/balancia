/**
 * Development seed data.
 *
 * Creates one registered user, two groups (one converted, one separate),
 * several participants and currencies, one expense per split method, a
 * multi-payer expense, a settlement, a recurring template and the activity
 * history that comes with all of it.
 *
 * Refuses to run against NODE_ENV=production — seeding a live instance would
 * inject fake financial records into someone's real data.
 */
import { closeDb, getDb } from "@/lib/db/client";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { registerUser } from "@/modules/auth/service";
import { createGroup } from "@/modules/groups/service";
import { addParticipant, createInvitation } from "@/modules/groups/service";
import { createExpense } from "@/modules/expenses/service";
import { createSettlement } from "@/modules/settlements/service";
import { createRecurringExpense } from "@/modules/recurring/service";
import { authorizeGroup, type UserActor } from "@/lib/security/authorization";
import { listParticipants } from "@/modules/groups/service";

const SEED_EMAIL = "ada@example.com";
const SEED_PASSWORD = "balancia-dev-password";

function today(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const env = getEnv();
  if (env.isProduction) {
    throw new Error(
      "Refusing to seed: NODE_ENV is production. Seed data must never be written to a live instance.",
    );
  }

  logger.info("Creating the seed user");
  const registered = await registerUser({
    name: "Ada Lovelace",
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
  });

  const actor: UserActor = {
    kind: "user",
    userId: registered.user.userId,
    email: registered.user.email,
    name: registered.user.name,
  };

  // ── Group 1: converted to EUR ────────────────────────────────────────────
  logger.info("Creating the converted-currency group");
  const trip = await createGroup(actor, {
    name: "Lisbon trip",
    description: "Four days, three people, too much pastry.",
    currencyMode: "converted",
    baseCurrency: "EUR",
    timezone: "Europe/Lisbon",
    ownerDisplayName: "Ada",
  });

  const tripAccess = await authorizeGroup(actor, trip.id);
  const blaise = await addParticipant(tripAccess, {
    displayName: "Blaise",
    email: "blaise@example.com",
  });
  const grace = await addParticipant(tripAccess, {
    displayName: "Grace",
    email: "",
  });
  const ada = trip.participantId;

  // Equal split
  await createExpense(tripAccess, {
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
  });

  // Exact amounts
  await createExpense(tripAccess, {
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
  });

  // Percentage split
  await createExpense(tripAccess, {
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
  });

  // Share-based split
  await createExpense(tripAccess, {
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
  });

  // Foreign currency, converted at a frozen rate
  await createExpense(tripAccess, {
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
  });

  // Multi-payer expense
  await createExpense(tripAccess, {
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
  });

  // Settlement
  await createSettlement(tripAccess, {
    fromParticipantId: blaise,
    toParticipantId: ada,
    amount: "5000",
    currency: "EUR",
    exchangeRate: "",
    settledOn: today(-1),
    notes: "Partial repayment",
  });

  // A guest link for Grace, who has no account.
  const invitation = await createInvitation(tripAccess, {
    participantId: grace,
  });

  // ── Group 2: separate currencies ────────────────────────────────────────
  logger.info("Creating the separate-currency group");
  const flat = await createGroup(actor, {
    name: "Flat share",
    description: "Rent, bills and the occasional joint grocery run.",
    currencyMode: "separate",
    timezone: "Europe/Paris",
    ownerDisplayName: "Ada",
  });

  const flatAccess = await authorizeGroup(actor, flat.id);
  const katherine = await addParticipant(flatAccess, {
    displayName: "Katherine",
    email: "katherine@example.com",
  });
  const adaFlat = flat.participantId;

  await createExpense(flatAccess, {
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
  });

  // A second currency in the same group — balanced independently.
  await createExpense(flatAccess, {
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
  });

  // Recurring expense: rent, monthly, in the group's timezone.
  await createRecurringExpense(flatAccess, {
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
  });

  const tripParticipants = await listParticipants(trip.id);

  logger.info(
    {
      user: SEED_EMAIL,
      groups: [trip.id, flat.id],
      participants: tripParticipants.length,
    },
    "Seed complete",
  );

  console.log(`
Seed data ready.

  Sign in with:
    Email:    ${SEED_EMAIL}
    Password: ${SEED_PASSWORD}

  Groups:
    Lisbon trip (converted to EUR):  /groups/${trip.id}
    Flat share  (separate currencies): /groups/${flat.id}

  Guest link for Grace (shown once, as in the real flow):
    ${env.appOrigin}/join/${invitation.token}
`);
}

main()
  .catch((error: unknown) => {
    logger.error(
      {
        err:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      },
      "Seed failed",
    );
    process.exitCode = 1;
  })
  .finally(() => {
    void getDb();
    void closeDb();
  });
