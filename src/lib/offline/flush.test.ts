import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedEntry } from "./outbox";

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

function entry(overrides: Partial<QueuedEntry> = {}): QueuedEntry {
  return {
    clientKey: "11111111-1111-4111-8111-111111111111",
    groupId: "22222222-2222-4222-8222-222222222222",
    groupName: "Lisbon",
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

    await flushOutbox({ now: 10_000 });

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

    const summary = await flushOutbox({ now: 10_000 });

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

    const summary = await flushOutbox({ now: 10_000 });

    expect(removeQueued).toHaveBeenCalledOnce();
    expect(summary.written).toBe(1);
  });

  it("keeps an entry when the request never came back", async () => {
    listQueued.mockResolvedValue([entry()]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    const summary = await flushOutbox({ now: 10_000 });

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

    const summary = await flushOutbox({ now: 10_000 });

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

    const summary = await flushOutbox({ now: 10_000 });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(summary.blocked).toBe(1);
  });

  it("waits out the backoff instead of retrying immediately", async () => {
    listQueued.mockResolvedValue([
      entry({ attempts: 1, lastAttemptAt: 10_000 }),
    ]);
    const fetchMock = answers(201);

    const summary = await flushOutbox({ now: 11_000 });

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

    const summary = await flushOutbox({ now: 10_000 });

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

    const summary = await flushOutbox({ now: 10_000 });

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

    const summary = await flushOutbox({ now: 10_000 });

    expect(removeQueued).toHaveBeenCalledExactlyOnceWith("b");
    expect(summary).toEqual({ written: 1, retrying: 0, blocked: 1 });
  });

  it("does nothing at all with an empty queue", async () => {
    listQueued.mockResolvedValue([]);
    const fetchMock = answers();

    expect(await flushOutbox()).toEqual({
      written: 0,
      retrying: 0,
      blocked: 0,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
