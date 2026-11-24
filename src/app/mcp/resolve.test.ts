import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserActor } from "@/lib/security/authorization";
import { pickPerson, resolveGroup } from "./resolve";
import { ToolFailure } from "./support";

const mocks = vi.hoisted(() => ({
  groups: [] as { id: string; name: string }[],
  authorizeGroup: vi.fn(async (_actor: unknown, groupId: string) => ({
    groupId,
  })),
}));

vi.mock("@/modules/groups/service", () => ({
  listGroupsForUser: vi.fn(async () => mocks.groups),
  listParticipants: vi.fn(async () => []),
}));

vi.mock("@/lib/security/authorization", () => ({
  authorizeGroup: mocks.authorizeGroup,
}));

/**
 * Who a model means by what it says.
 *
 * This resolves who owes whom, and a wrong guess is money moved between the
 * wrong two people, so the rule is to be exact where it can and to refuse where
 * it cannot — never to take the nearest thing.
 */

const ADA = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Ada Lovelace",
};
const MARTA = { id: "22222222-2222-4222-8222-222222222222", name: "Marta" };
const MARCO = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Marco Silva",
};
const ZOË = { id: "44444444-4444-4444-8444-444444444444", name: "Zoë" };
const PEOPLE = [ADA, MARTA, MARCO, ZOË];
const ME = { participantId: ADA.id };

const pick = (ref: string, people = PEOPLE) =>
  pickPerson(people, ref, ME, "payer");

/** The message a call refuses with; fails the test if it does not refuse. */
function failure(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(ToolFailure);
    return (error as Error).message;
  }
  throw new Error("expected a refusal");
}

describe("naming a member", () => {
  it("takes a full name, in any case and without accents", () => {
    expect(pick("ada lovelace")).toBe(ADA);
    expect(pick("ZOE")).toBe(ZOË);
    expect(pick("  Marta  ")).toBe(MARTA);
  });

  it("takes an id", () => {
    expect(pick(MARCO.id)).toBe(MARCO);
  });

  it('takes "me" as the connected account\'s own seat, whatever it is called there', () => {
    expect(pick("me")).toBe(ADA);
    expect(pick("Me")).toBe(ADA);
  });

  it('refuses "me" when the account has no seat in the group', () => {
    expect(() =>
      pickPerson(PEOPLE, "me", { participantId: null }, "payer"),
    ).toThrow(ToolFailure);
  });

  it("takes a first name when it is the only one", () => {
    expect(pick("Ada")).toBe(ADA);
    expect(pick("Marco")).toBe(MARCO);
  });

  it("takes a prefix long enough to mean something", () => {
    expect(pick("marc")).toBe(MARCO);
  });

  it("does not take a prefix of one or two letters for anybody", () => {
    // Neither is an abbreviation of a name. In a group with one person who
    // happens to start with that letter, taking it would be a guess that looks
    // like an answer.
    expect(() => pick("A")).toThrow(/No payer in this group matches "A"/);
    expect(() => pick("Ma")).toThrow(ToolFailure);
    expect(() => pick("m")).toThrow(ToolFailure);
  });

  it("still takes a short first name when it is exactly that", () => {
    const al = { id: "55555555-5555-4555-8555-555555555555", name: "Al Green" };
    expect(pick("Al", [ADA, al])).toBe(al);
  });

  it("refuses to choose between two people who fit, and lists them with their ids", () => {
    expect(() => pick("mar")).toThrow(/could be more than one payer/);
    try {
      pick("mar");
    } catch (error) {
      expect((error as Error).message).toContain(MARTA.id);
      expect((error as Error).message).toContain(MARCO.id);
    }
  });

  it("refuses an exact name while a longer one starts with it, and lists every one", () => {
    // Anybody with the join link picks their own name, so the exact match may
    // be the one who arrived last, under a name chosen to catch a change.
    const longer = {
      id: "66666666-6666-4666-8666-666666666666",
      name: "Marta Costa",
    };
    const message = failure(() => pick("Marta", [ADA, MARTA, longer]));
    expect(message).toMatch(/could be more than one payer/);
    expect(message).toContain(MARTA.id);
    expect(message).toContain(longer.id);
    expect(message).not.toContain(ADA.id);
    expect(message).toContain("Nothing was changed");
  });

  it('does not let a guest who joined as "Ben" take what was meant for Ben Carter', () => {
    const carter = {
      id: "77777777-7777-4777-8777-777777777777",
      name: "Ben Carter",
    };
    const guest = {
      id: "88888888-8888-4888-8888-888888888888",
      name: "Ben",
    };
    const message = failure(() => pick("Ben", [ADA, carter, guest]));
    expect(message).toContain(carter.id);
    expect(message).toContain(guest.id);

    // Before the guest arrived, "Ben" meant the one Ben there was.
    expect(pick("Ben", [ADA, carter])).toBe(carter);
    // The full name is still only one of them, and the ids always are.
    expect(pick("Ben Carter", [ADA, carter, guest])).toBe(carter);
    expect(pick(carter.id, [ADA, carter, guest])).toBe(carter);
    expect(pick(guest.id, [ADA, carter, guest])).toBe(guest);
    expect(pick("me", [ADA, carter, guest])).toBe(ADA);
  });

  it("takes an id only as the id of somebody in the group, never as a name", () => {
    // A display name is free text, so somebody can be called by an id that
    // belongs to a member who has since left.
    const gone = "99999999-9999-4999-8999-999999999999";
    const impostor = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: gone };
    expect(() => pick(gone, [ADA, impostor])).toThrow(
      /Nobody in this group has the id/,
    );
    expect(pick(MARCO.id.toUpperCase())).toBe(MARCO);
  });

  it('takes "me" even when a member is called "Me"', () => {
    const called = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Me" };
    expect(pick("me", [ADA, called])).toBe(ADA);
  });

  it("tells the model who is in the group when nobody fits", () => {
    expect(() => pick("Nobody")).toThrow(/Members: "Ada Lovelace", "Marta"/);
  });
});

describe("naming a group", () => {
  const ACTOR = { userId: "u" } as UserActor;
  const MINE = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    name: "Lisbon trip 2026",
  };
  const TRAP = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Lisbon" };
  const FLAT = { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", name: "Flat" };

  beforeEach(() => {
    mocks.authorizeGroup.mockClear();
    mocks.groups = [MINE, TRAP, FLAT];
  });

  async function refusal(reference: string, requireActive?: boolean) {
    const error = await resolveGroup(ACTOR, reference, {
      requireActive,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ToolFailure);
    return (error as Error).message;
  }

  it("refuses a name that is one group's and part of another's, for a change and for a read", async () => {
    for (const changing of [true, false]) {
      const message = await refusal("Lisbon", changing);
      expect(message).toContain(MINE.id);
      expect(message).toContain(TRAP.id);
      expect(message).not.toContain(FLAT.id);
    }
    expect(mocks.authorizeGroup).not.toHaveBeenCalled();
  });

  it("takes a name that only one group could mean, whole or in part", async () => {
    await resolveGroup(ACTOR, "lisbon trip 2026");
    expect(mocks.authorizeGroup).toHaveBeenLastCalledWith(
      ACTOR,
      MINE.id,
      expect.anything(),
    );
    await resolveGroup(ACTOR, "trip");
    expect(mocks.authorizeGroup).toHaveBeenLastCalledWith(
      ACTOR,
      MINE.id,
      expect.anything(),
    );
    await resolveGroup(ACTOR, "flat");
    expect(mocks.authorizeGroup).toHaveBeenLastCalledWith(
      ACTOR,
      FLAT.id,
      expect.anything(),
    );
  });

  it("takes an exact name when nothing else could be meant", async () => {
    mocks.groups = [TRAP, FLAT];
    await resolveGroup(ACTOR, "Lisbon", { requireActive: true });
    expect(mocks.authorizeGroup).toHaveBeenLastCalledWith(ACTOR, TRAP.id, {
      requireActive: true,
    });
  });

  it("takes an id directly, whatever the names", async () => {
    await resolveGroup(ACTOR, TRAP.id, { requireActive: true });
    expect(mocks.authorizeGroup).toHaveBeenLastCalledWith(ACTOR, TRAP.id, {
      requireActive: true,
    });
  });

  it("refuses two groups with one name, with both ids", async () => {
    const twin = { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "flat" };
    mocks.groups = [FLAT, twin];
    const message = await refusal("Flat");
    expect(message).toContain(FLAT.id);
    expect(message).toContain(twin.id);
  });

  it("looks only at a pinned connection's own group", async () => {
    await resolveGroup({ ...ACTOR, tokenGroupId: TRAP.id }, "Lisbon");
    expect(mocks.authorizeGroup).toHaveBeenLastCalledWith(
      expect.objectContaining({ tokenGroupId: TRAP.id }),
      TRAP.id,
      expect.anything(),
    );
  });
});

describe("saying that a name in a refusal was typed by somebody", () => {
  const ACTOR = { userId: "u" } as UserActor;

  function caught(call: () => unknown): ToolFailure {
    try {
      call();
    } catch (error) {
      expect(error).toBeInstanceOf(ToolFailure);
      return error as ToolFailure;
    }
    throw new Error("expected a refusal");
  }

  async function refused(reference: string): Promise<ToolFailure> {
    const error = await resolveGroup(ACTOR, reference).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(ToolFailure);
    return error as ToolFailure;
  }

  it("marks every refusal that lists members", () => {
    const twin = {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Marta Ruiz",
    };
    expect(caught(() => pick("Nobody")).quotesMembers).toBe(true);
    expect(caught(() => pick("Marta", [...PEOPLE, twin])).quotesMembers).toBe(
      true,
    );
    expect(
      caught(() => pick("99999999-9999-4999-8999-999999999999")).quotesMembers,
    ).toBe(true);
  });

  it("marks the refusals that list groups, and not the one that lists none", async () => {
    mocks.groups = [
      { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Lisbon trip" },
      { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", name: "Lisbon" },
    ];
    expect((await refused("Lisbon")).quotesMembers).toBe(true);
    expect((await refused("Paris")).quotesMembers).toBe(true);

    mocks.groups = [];
    expect((await refused("Paris")).quotesMembers).toBe(false);
  });
});
