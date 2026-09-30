import { z } from "zod";

/**
 * Whether a value is an idempotency key this server will store.
 *
 * One rule for both ways a key arrives — the `Idempotency-Key` header the
 * outbox replays under, and the `clientKey` argument the entry form hands its
 * Server Action — because both land in the same unique text index. A UUID and
 * nothing else: it is what every client Balancia ships mints (`randomKey` in
 * `lib/offline/idb.ts`), and its fixed length is the only ceiling that index
 * has.
 *
 * What a caller does with a key that fails is its own decision. The API ignores
 * one, for the reason given at `idempotencyKey` in `app/api/mobile.ts`; an
 * action refuses one, since the only form that calls it never sends anything
 * else and a write that landed without its key could not be matched by the
 * replay that follows a lost answer.
 */
const keySchema = z.uuid();

export function isIdempotencyKey(value: unknown): value is string {
  return keySchema.safeParse(value).success;
}
