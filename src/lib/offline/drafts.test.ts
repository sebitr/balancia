import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntryDraft } from "./drafts";
import type { DeviceActor } from "./owner";

/**
 * Whose draft comes back.
 *
 * A half-typed amount is private in the same way an unsent entry is: the next
 * person to sign in on the phone is not offered what the last one was in the
 * middle of.
 */

const idbGet = vi.fn<(store: string, key: string) => Promise<unknown>>();
const idbDelete = vi.fn<(store: string, key: string) => Promise<void>>();

vi.mock("./idb", () => ({
  DRAFT_STORE: "entry-drafts",
  idbGet: (store: string, key: string) => idbGet(store, key),
  idbDelete: (store: string, key: string) => idbDelete(store, key),
  idbPut: vi.fn(),
}));

const { loadDraft, DRAFT_TTL_MS } = await import("./drafts");

const LISBON = "22222222-2222-4222-8222-222222222222";

const ADA: DeviceActor = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  groupId: LISBON,
  participantId: "aaaaaaaa-0000-4000-8000-00000000000a",
};

const BEN: DeviceActor = {
  userId: "bbbbbbbb-0000-4000-8000-000000000001",
  groupId: LISBON,
  participantId: "bbbbbbbb-0000-4000-8000-00000000000b",
};

function draft(overrides: Partial<EntryDraft> = {}): EntryDraft {
  return {
    groupId: LISBON,
    owner: { kind: "user", userId: ADA.userId! },
    savedAt: 1_000,
    fields: {},
    summary: { amount: "84.20", description: "Dinner" },
    ...overrides,
  };
}

beforeEach(() => {
  idbGet.mockReset();
  idbDelete.mockReset().mockResolvedValue(undefined);
});

describe("loadDraft", () => {
  it("offers the draft back to the person who was typing it", async () => {
    idbGet.mockResolvedValue(draft());

    expect(await loadDraft(ADA, 2_000)).toMatchObject({
      summary: { amount: "84.20" },
    });
    expect(idbGet).toHaveBeenCalledWith("entry-drafts", LISBON);
  });

  it("offers it to nobody else, and leaves it where it is", async () => {
    idbGet.mockResolvedValue(draft());

    expect(await loadDraft(BEN, 2_000)).toBeNull();
    expect(idbDelete).not.toHaveBeenCalled();
  });

  it("offers a draft nobody could place to nobody", async () => {
    idbGet.mockResolvedValue(draft({ owner: null }));

    expect(await loadDraft(ADA, 2_000)).toBeNull();
  });

  it("still sweeps an expired draft away, whoever is looking", async () => {
    idbGet.mockResolvedValue(draft());

    expect(await loadDraft(BEN, 1_000 + DRAFT_TTL_MS)).toBeNull();
    expect(idbDelete).toHaveBeenCalledWith("entry-drafts", LISBON);
  });
});
