import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedEntry } from "./outbox";
import type { DeviceActor, EntryOwner } from "./owner";

/**
 * Draining the queue.
 *
 * The store underneath is mocked rather than faked, which is the point: what
 * is worth pinning here is not that IndexedDB can hold a record — it is what
 * the flush *does* with the answers it gets, and that is decided entirely by
 * the four calls this file makes. An entry removed on the wrong answer is
 * somebody's expense gone; an entry sent without its key is somebody's expense
 * written twice.
 */

const listQueued = vi.fn<() => Promise<QueuedEntry[]>>();
const removeQueued = vi.fn<(clientKey: string) => Promise<void>>();
const recordAttempt =
  vi.fn<(entry: QueuedEntry, update: unknown) => Promise<void>>();

vi.mock("./outbox", () => ({
  listQueued: () => listQueued(),
  removeQueued: (key: string) => removeQueued(key),
  recordAttempt: (entry: QueuedEntry, update: unknown) =>
    recordAttempt(entry, update),
}));

const { flushOutbox } = await import("./flush");

const LISBON = "22222222-2222-4222-8222-222222222222";
const FLAT = "33333333-3333-4333-8333-333333333333";

/** Signed in, in Lisbon, on her own seat there. */
const ADA: DeviceActor = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  groupId: LISBON,
  participantId: "aaaaaaaa-0000-4000-8000-00000000000a",
};

/** Another account in the same group, on the same phone, later. */
const BEN: DeviceActor = {
  userId: "bbbbbbbb-0000-4000-8000-000000000001",
  groupId: LISBON,
  participantId: "bbbbbbbb-0000-4000-8000-00000000000b",
};

const BY_ADA: EntryOwner = { kind: "user", userId: ADA.userId! };

function entry(overrides: Partial<QueuedEntry> = {}): QueuedEntry {
  return {
    clientKey: "11111111-1111-4111-8111-111111111111",
    groupId: LISBON,
    groupName: "Lisbon",
    owner: BY_ADA,
    payload: {
      description: "Pastéis",
      amount: "640",
      currency: "EUR",
      expenseDate: "2026-08-29",
      payers: [{ participantId: "p1", amount: "640" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: "p1" }],
    } as QueuedEntry["payload"],
    queuedAt: 1_000,
    attempts: 0,
    lastAttemptAt: null,
    status: "queued",
    blockedFor: null,
    ...overrides,
  };
}

function answers(...statuses: number[]) {
  const fetchMock = vi.fn();
  for (const status of statuses) {
    fetchMock.mockResolvedValueOnce({ status } as Response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  listQueued.mockReset();
  removeQueued.mockReset();
  recordAttempt.mockReset();
  removeQueued.mockResolvedValue(undefined);
  recordAttempt.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("flushOutbox", () => {
  it("sends the entry under its own key, to its own group", async () => {
    listQueued.mockResolvedValue([entry()]);
    const fetchMock = answers(201);

    await flushOutbox({ actor: ADA, now: 10_000 });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "/api/groups/22222222-2222-4222-8222-222222222222/expenses",
    );
    // The header is the whole guarantee against a double write. If this
    // assertion ever fails, a lost response becomes a second expense.
    expect((init as RequestInit).headers).toMatchObject({
      "Idempotency-Key": "11111111-1111-4111-8111-111111111111",
    });
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      description: "Pastéis",
      amount: "640",
    });
  });

  it("drops an entry the server has taken", async () => {
    listQueued.mockResolvedValue([entry()]);
    answers(201);

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(removeQueued).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(summary).toEqual({ written: 1, retrying: 0, blocked: 0 });
  });

  it("drops an entry on a plain 200 as well", async () => {
    // The route answers 201 to a replay as much as to a fresh write, so this
    // is defensive rather than a case that happens today. It is here because
    // the cost of getting it wrong is asymmetric: a status this module fails
    // to recognise as success leaves the entry queued and offered forever.
    listQueued.mockResolvedValue([entry()]);
    answers(200);

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(removeQueued).toHaveBeenCalledOnce();
    expect(summary.written).toBe(1);
  });

  it("keeps an entry when the request never came back", async () => {
    listQueued.mockResolvedValue([entry()]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(removeQueued).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "queued" }),
    );
    expect(summary).toEqual({ written: 0, retrying: 1, blocked: 0 });
  });

  it("holds an entry back for a person once the server has refused it", async () => {
    listQueued.mockResolvedValue([entry()]);
    answers(422);

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(removeQueued).not.toHaveBeenCalled();
    expect(recordAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "blocked", blockedFor: "refused" }),
    );
    expect(summary).toEqual({ written: 0, retrying: 0, blocked: 1 });
  });

  it("does not keep asking about an entry that is already blocked", async () => {
    listQueued.mockResolvedValue([entry({ status: "blocked" })]);
    const fetchMock = answers(201);

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary.blocked).toBe(1);
  });

  it("waits out the backoff instead of retrying immediately", async () => {
    listQueued.mockResolvedValue([
      entry({ attempts: 1, lastAttemptAt: 10_000 }),
    ]);
    const fetchMock = answers(201);

    const summary = await flushOutbox({ actor: ADA, now: 11_000 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary.retrying).toBe(1);
  });

  it("stops at the first entry it could not send", async () => {
    // Four expenses from one dinner. Whatever stopped the first will stop the
    // rest, and marching on would burn every one of their backoffs to learn
    // the same thing four times.
    listQueued.mockResolvedValue([
      entry({ clientKey: "a" }),
      entry({ clientKey: "b" }),
      entry({ clientKey: "c" }),
    ]);
    const fetchMock = answers(500);

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(summary).toEqual({ written: 0, retrying: 1, blocked: 0 });
  });

  it("sends the whole evening in the order it was typed", async () => {
    listQueued.mockResolvedValue([
      entry({ clientKey: "a", queuedAt: 1 }),
      entry({ clientKey: "b", queuedAt: 2 }),
      entry({ clientKey: "c", queuedAt: 3 }),
    ]);
    answers(201, 201, 201);

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(removeQueued.mock.calls.map(([key]) => key)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(summary.written).toBe(3);
  });

  it("carries on past an entry the server refused", async () => {
    // A blocked entry is not a reason to strand the three behind it: it is
    // waiting on a person, and the rest are only waiting on the network.
    listQueued.mockResolvedValue([
      entry({ clientKey: "a" }),
      entry({ clientKey: "b" }),
    ]);
    answers(422, 201);

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(removeQueued).toHaveBeenCalledExactlyOnceWith("b");
    expect(summary).toEqual({ written: 1, retrying: 0, blocked: 1 });
  });

  it("does nothing at all with an empty queue", async () => {
    listQueued.mockResolvedValue([]);
    const fetchMock = answers();

    expect(await flushOutbox({ actor: ADA })).toEqual({
      written: 0,
      retrying: 0,
      blocked: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * Whose entries go.
 *
 * The request carries whichever session cookie the browser holds, so the
 * flush is the last place that can tell one person's evening from another's.
 * The case these exist for: Ada queues a dinner with no signal, her session
 * lapses, Ben signs in on the same phone — and Ben is in the same group, so
 * the server would have taken Ada's dinner as his.
 */
describe("flushOutbox, for whoever is signed in", () => {
  it("does not send an entry somebody else typed, even in the same group", async () => {
    listQueued.mockResolvedValue([entry()]);
    const fetchMock = answers(201);

    const summary = await flushOutbox({ actor: BEN, now: 10_000 });

    expect(fetchMock).not.toHaveBeenCalled();
    // Untouched, too: not dropped, and no attempt recorded against its
    // backoff. It is waiting for Ada, not for a network.
    expect(removeQueued).not.toHaveBeenCalled();
    expect(recordAttempt).not.toHaveBeenCalled();
    expect(summary).toEqual({ written: 0, retrying: 0, blocked: 0 });
  });

  it("sends its author's entries once they are back", async () => {
    listQueued.mockResolvedValue([entry()]);
    const fetchMock = answers(201);

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(summary.written).toBe(1);
  });

  it("sends an account's entries from whichever group it is in", async () => {
    // Typed in the flat's group, drained from Lisbon's screen: an account is
    // the same person everywhere, and the queue drains in the order it was
    // filled rather than group by group.
    listQueued.mockResolvedValue([entry({ groupId: FLAT })]);
    const fetchMock = answers(201);

    await flushOutbox({ actor: ADA, now: 10_000 });

    expect(fetchMock.mock.calls[0]![0]).toBe(`/api/groups/${FLAT}/expenses`);
  });

  it("sends the reader's own and leaves somebody else's where it is", async () => {
    listQueued.mockResolvedValue([
      entry({
        clientKey: "ben's",
        owner: { kind: "user", userId: BEN.userId! },
      }),
      entry({ clientKey: "ada's" }),
    ]);
    answers(201);

    const summary = await flushOutbox({ actor: ADA, now: 10_000 });

    expect(removeQueued).toHaveBeenCalledExactlyOnceWith("ada's");
    expect(summary).toEqual({ written: 1, retrying: 0, blocked: 0 });
  });

  it("sends a guest's entry as that guest's seat, and as nobody else's", async () => {
    const seat: EntryOwner = {
      kind: "participant",
      groupId: LISBON,
      participantId: "cccccccc-0000-4000-8000-00000000000c",
    };
    const guest: DeviceActor = {
      userId: null,
      groupId: LISBON,
      participantId: seat.participantId,
    };
    listQueued.mockResolvedValue([entry({ owner: seat })]);
    const fetchMock = answers(201);

    await flushOutbox({ actor: BEN, now: 10_000 });
    expect(fetchMock).not.toHaveBeenCalled();

    await flushOutbox({ actor: guest, now: 10_000 });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("still sends a guest's entry once that guest has signed up", async () => {
    // Signing up claims the seat: the same participant row, now linked to an
    // account. What the guest typed at dinner is theirs under either name.
    const seat: EntryOwner = {
      kind: "participant",
      groupId: LISBON,
      participantId: "cccccccc-0000-4000-8000-00000000000c",
    };
    listQueued.mockResolvedValue([entry({ owner: seat })]);
    const fetchMock = answers(201);

    await flushOutbox({
      actor: {
        userId: "cccccccc-0000-4000-8000-000000000001",
        groupId: LISBON,
        participantId: seat.participantId,
      },
      now: 10_000,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("recognises a seat only inside its own group", async () => {
    // A participant id means nothing in another group, so an entry stamped
    // with one waits until its group is on screen.
    const seat: EntryOwner = {
      kind: "participant",
      groupId: FLAT,
      participantId: ADA.participantId!,
    };
    listQueued.mockResolvedValue([entry({ groupId: FLAT, owner: seat })]);
    const fetchMock = answers(201);

    await flushOutbox({ actor: ADA, now: 10_000 });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("holds an entry from before owners were kept, if the upgrade could not adopt it", async () => {
    // The upgrade stamps every older entry with the seat its group's
    // snapshot named (see `adoptUnowned`). One it could not place belongs to
    // nobody: sending it as whoever happens to be signed in is the bug.
    listQueued.mockResolvedValue([
      entry({ owner: null }),
      { ...entry(), owner: undefined } as unknown as QueuedEntry,
    ]);
    const fetchMock = answers(201, 201);

    await flushOutbox({ actor: ADA, now: 10_000 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(removeQueued).not.toHaveBeenCalled();
  });
});
