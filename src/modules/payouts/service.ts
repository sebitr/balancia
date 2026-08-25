import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { participants, payoutAddresses, payoutMethods } from "@/lib/db/schema";
import { normalizePayoutDetail, validatePayoutDetail } from "./fields";
import type { SwissCreditorAddress } from "./qr/swiss";

/**
 * Reading and writing how somebody wants to be paid back.
 *
 * Two operations and a rule. The rule is the interesting part: these details
 * are readable by exactly the people who owe their owner money, and that is
 * enforced by never exposing a way to ask for them by name. `listPayoutsOwed`
 * takes the transfers the caller has been told they owe — computed from the
 * group's own balances — and answers for those recipients only. There is no
 * "show me X's IBAN" to call.
 */

export interface PayoutMethodInput {
  readonly method: string;
  readonly detail: string;
}

export interface PayoutMethodView {
  readonly method: string;
  readonly detail: string;
}

/**
 * A creditor's postal address, for the one standard that requires one.
 *
 * Read alongside the methods rather than separately: the only reason to have
 * it is to put it in a Swiss QR code beside the IBAN, and a caller holding one
 * without the other can do nothing with either.
 */
export type PayoutAddressView = SwissCreditorAddress;

export class PayoutValidationError extends Error {
  constructor(
    readonly method: string,
    /** A key under `payouts.errors`. */
    readonly reason: string,
  ) {
    super(`Invalid payout detail for ${method}: ${reason}`);
    this.name = "PayoutValidationError";
  }
}

/** The maximum anybody needs; past this it is a list nobody reads. */
const MAX_METHODS = 8;

export async function listPayoutMethods(
  userId: string,
  options: { db?: Database } = {},
): Promise<readonly PayoutMethodView[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({ method: payoutMethods.method, detail: payoutMethods.detail })
    .from(payoutMethods)
    .where(eq(payoutMethods.userId, userId))
    .orderBy(asc(payoutMethods.position), asc(payoutMethods.method));
  return rows;
}

/**
 * Replaces the whole list, in the order given.
 *
 * The whole list rather than one row, for the same reason the currency
 * favourites are written that way: the order is the owner's and the server
 * cannot reconstruct it from a single toggle. Deleting and re-inserting inside
 * one transaction keeps `position` contiguous without a second pass to
 * renumber, and means a failed write leaves the previous list intact rather
 * than half of a new one.
 */
export async function replacePayoutMethods(
  userId: string,
  entries: readonly PayoutMethodInput[],
  options: { db?: Database } = {},
): Promise<readonly PayoutMethodView[]> {
  const db = options.db ?? getDb();

  const seen = new Set<string>();
  const cleaned: { method: string; detail: string }[] = [];
  for (const entry of entries.slice(0, MAX_METHODS)) {
    const method = entry.method.trim().toLowerCase();
    // The database says the same thing in a CHECK; saying it here first is
    // what turns a constraint violation into a message about one row.
    if (!/^[a-z0-9_]{2,40}$/.test(method)) {
      throw new PayoutValidationError(method, "unknownMethod");
    }
    if (seen.has(method)) continue;
    seen.add(method);

    const problem = validatePayoutDetail(method, entry.detail);
    if (problem) throw new PayoutValidationError(method, problem);
    cleaned.push({
      method,
      detail: normalizePayoutDetail(method, entry.detail),
    });
  }

  await db.transaction(async (tx) => {
    await tx.delete(payoutMethods).where(eq(payoutMethods.userId, userId));
    if (cleaned.length === 0) return;
    await tx.insert(payoutMethods).values(
      cleaned.map((entry, position) => ({
        userId,
        method: entry.method,
        detail: entry.detail,
        position,
      })),
    );
  });

  return cleaned;
}

/**
 * The payout details of people the caller owes money to.
 *
 * The permission *is* the argument: a recipient reaches this list only by
 * appearing in a transfer the caller has been told to make, and those come
 * from the group's own balances. Passing an arbitrary participant id gets
 * nothing back unless that participant is in the list the caller was given.
 *
 * Guests are absent rather than empty — a guest has no account to hang a bank
 * account on, and the screen says so instead of showing a blank.
 */
export async function listPayoutsOwed(
  groupId: string,
  recipientParticipantIds: readonly string[],
  options: { db?: Database } = {},
): Promise<ReadonlyMap<string, readonly PayoutMethodView[]>> {
  const unique = [...new Set(recipientParticipantIds)];
  if (unique.length === 0) return new Map();

  const db = options.db ?? getDb();
  const rows = await db
    .select({
      participantId: participants.id,
      method: payoutMethods.method,
      detail: payoutMethods.detail,
      position: payoutMethods.position,
    })
    .from(participants)
    .innerJoin(payoutMethods, eq(payoutMethods.userId, participants.userId))
    .where(
      and(
        // Scoped to the group the debt was computed in, so a participant id
        // from somewhere else cannot be smuggled in.
        eq(participants.groupId, groupId),
        inArray(participants.id, unique),
      ),
    )
    .orderBy(asc(payoutMethods.position), asc(payoutMethods.method));

  const byParticipant = new Map<string, PayoutMethodView[]>();
  for (const row of rows) {
    const list = byParticipant.get(row.participantId) ?? [];
    list.push({ method: row.method, detail: row.detail });
    byParticipant.set(row.participantId, list);
  }
  return byParticipant;
}

export async function getPayoutAddress(
  userId: string,
  options: { db?: Database } = {},
): Promise<PayoutAddressView | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select({
      street: payoutAddresses.street,
      buildingNumber: payoutAddresses.buildingNumber,
      postalCode: payoutAddresses.postalCode,
      town: payoutAddresses.town,
      country: payoutAddresses.country,
    })
    .from(payoutAddresses)
    .where(eq(payoutAddresses.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Saves the address, or removes it.
 *
 * Null clears the row rather than blanking its columns, because "no address"
 * and "an address of nothing" are the same thing to everybody upstream and the
 * table should not be able to hold the second.
 */
export async function savePayoutAddress(
  userId: string,
  address: PayoutAddressView | null,
  options: { db?: Database } = {},
): Promise<void> {
  const db = options.db ?? getDb();

  if (!address) {
    await db.delete(payoutAddresses).where(eq(payoutAddresses.userId, userId));
    return;
  }

  const values = {
    street: trimOrNull(address.street, 70),
    buildingNumber: trimOrNull(address.buildingNumber, 16),
    postalCode: address.postalCode.trim().slice(0, 16),
    town: address.town.trim().slice(0, 35),
    country: address.country.trim().toUpperCase().slice(0, 2),
  };

  await db
    .insert(payoutAddresses)
    .values({ userId, ...values })
    .onConflictDoUpdate({
      target: payoutAddresses.userId,
      set: { ...values, updatedAt: new Date() },
    });
}

/**
 * The addresses of the people the caller owes, keyed by participant.
 *
 * Same rule as `listPayoutsOwed`, and the same shape of argument: an address
 * is reachable only through a debt the balances computed. It is loaded at all
 * because a Swiss QR code cannot be built without one.
 */
export async function listPayoutAddressesOwed(
  groupId: string,
  recipientParticipantIds: readonly string[],
  options: { db?: Database } = {},
): Promise<ReadonlyMap<string, PayoutAddressView>> {
  const unique = [...new Set(recipientParticipantIds)];
  if (unique.length === 0) return new Map();

  const db = options.db ?? getDb();
  const rows = await db
    .select({
      participantId: participants.id,
      street: payoutAddresses.street,
      buildingNumber: payoutAddresses.buildingNumber,
      postalCode: payoutAddresses.postalCode,
      town: payoutAddresses.town,
      country: payoutAddresses.country,
    })
    .from(participants)
    .innerJoin(payoutAddresses, eq(payoutAddresses.userId, participants.userId))
    .where(
      and(eq(participants.groupId, groupId), inArray(participants.id, unique)),
    );

  return new Map(
    rows.map((row) => [
      row.participantId,
      {
        street: row.street,
        buildingNumber: row.buildingNumber,
        postalCode: row.postalCode,
        town: row.town,
        country: row.country,
      },
    ]),
  );
}

function trimOrNull(value: string | null, max: number): string | null {
  const trimmed = (value ?? "").trim().slice(0, max);
  return trimmed.length > 0 ? trimmed : null;
}
