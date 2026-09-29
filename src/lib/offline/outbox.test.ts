import { beforeEach, describe, expect, it, vi } from "vitest";
import type { QueuedEntry } from "./outbox";
import type { DeviceActor } from "./owner";

/**
 * The pending rows a group shows, and whose they are.
 *
 * The store is mocked: the question is only which of the entries it holds are
 * listed for the reader on screen.
 */

const idbGetAll = vi.fn<(store: string) => Promise<unknown[]>>();

vi.mock("./idb", () => ({
  OUTBOX_STORE: "outbox",
  idbGetAll: (store: string) => idbGetAll(store),
  idbPut: vi.fn(),
  idbDelete: vi.fn(),
  randomKey: () => "key",
}));

const { listQueuedFor } = await import("./outbox");

const LISBON = "22222222-2222-4222-8222-222222222222";
const FLAT = "33333333-3333-4333-8333-333333333333";

const ADA: DeviceActor = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  groupId: LISBON,
  participantId: "aaaaaaaa-0000-4000-8000-00000000000a",
};

function entry(
  clientKey: string,
  groupId: string,
  owner: QueuedEntry["owner"],
  queuedAt: number,
): QueuedEntry {
  return {
    clientKey,
    groupId,
    groupName: "",
    owner,
    payload: {} as QueuedEntry["payload"],
    queuedAt,
    attempts: 0,
    lastAttemptAt: null,
    status: "queued",
    blockedFor: null,
  };
}

beforeEach(() => {
  idbGetAll.mockReset();
});

describe("listQueuedFor", () => {
  it("lists the reader's own entries in this group, oldest first", async () => {
    const mine = { kind: "user", userId: ADA.userId! } as const;
    idbGetAll.mockResolvedValue([
      entry("later", LISBON, mine, 2),
      entry("elsewhere", FLAT, mine, 1),
      entry("ben's", LISBON, { kind: "user", userId: "ben" }, 0),
      entry("nobody's", LISBON, null, 0),
      entry("first", LISBON, mine, 1),
    ]);

    const listed = await listQueuedFor(ADA);

    // Somebody else's entry in the same group is not a row here: it will not
    // be sent from this session, so a "syncing" line about it never ends.
    expect(listed.map((queued) => queued.clientKey)).toEqual([
      "first",
      "later",
    ]);
  });
});
