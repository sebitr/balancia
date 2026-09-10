import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GuestActor, UserActor } from "@/lib/security/authorization";
import { createApiToken } from "@/modules/api-tokens/service";
import { createTestGroup, createTestUser } from "../helpers/factories";

/**
 * The recipe in `docs/shortcuts.md`, run.
 *
 * That document promises somebody with no Xcode and no code that three HTTP
 * calls turn a spoken sentence into an expense: parse the words, read the
 * group, write the entry. It is a promise made in prose, to people who cannot
 * read the source to check it, and prose does not fail a build when a field is
 * renamed underneath it.
 *
 * So the recipe is executed here rather than described twice. Every field the
 * document tells a reader to pluck out of a response is plucked out of a real
 * response below, and the entry that comes out the far end is read back and
 * checked against what was said. A rename that breaks a shortcut somebody
 * built six months ago fails here first.
 *
 * The cookie path is mocked to null throughout, as in `api-tokens.test.ts`:
 * a shortcut holds a key and nothing else, so if any call here succeeded on a
 * session it would be proving the wrong thing.
 */

const cookieActor = vi.hoisted(() => ({
  value: null as UserActor | GuestActor | null,
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () =>
    cookieActor.value?.kind === "user" ? cookieActor.value : null,
  getCurrentActor: async () => cookieActor.value,
  getClientIp: async () => "127.0.0.1",
}));

const parseRoute = await import("@/app/api/parse/route");
const groupRoute = await import("@/app/api/groups/[groupId]/route");
const expensesRoute = await import("@/app/api/groups/[groupId]/expenses/route");

beforeEach(() => {
  cookieActor.value = null;
});

function context(groupId: string) {
  return { params: Promise.resolve({ groupId }) } as never;
}

function call(
  path: string,
  token: string,
  options: { method?: string; body?: unknown } = {},
): Request {
  return new Request(`http://localhost${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

async function setup() {
  const owner = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(owner, {
    name: "Lisbon",
    currencyMode: "converted",
    baseCurrency: "CHF",
  });
  const { token } = await createApiToken(owner.userId, {
    name: "Shortcuts",
    scope: "write",
    groupId: group.groupId,
  });
  return { owner, group, token };
}

describe("the documented shortcut recipe", () => {
  it("turns a spoken sentence into an expense in three calls", async () => {
    const { group, token } = await setup();

    // 1. What did they say? The group's own currency is the fallback, which is
    //    why step 2 in the document reads the group before parsing anything
    //    that has to be denominated.
    const parsed = await (
      await parseRoute.POST(
        call("/api/parse", token, {
          method: "POST",
          body: { text: "24.50 francs Coop", fallbackCurrency: "CHF" },
        }),
      )
    ).json();

    expect(parsed.description).toBe("Coop");
    expect(parsed.currency).toBe("CHF");
    // The field the document tells a shortcut to send straight on. Without it
    // the recipe would need an ISO 4217 table on the shortcut's side.
    expect(parsed.amountMinor).toBe("2450");

    // 2. Who am I in this group, and who is in it?
    const read = await (
      await groupRoute.GET(
        call(`/api/groups/${group.groupId}`, token),
        context(group.groupId),
      )
    ).json();

    expect(read.group.baseCurrency).toBe("CHF");
    expect(read.participantId).toEqual(expect.any(String));
    expect(read.participants.length).toBeGreaterThan(0);

    // 3. Write it, with the two ids the read just handed over.
    const written = await expensesRoute.POST(
      call(`/api/groups/${group.groupId}/expenses`, token, {
        method: "POST",
        body: {
          description: parsed.description,
          amount: parsed.amountMinor,
          currency: parsed.currency,
          expenseDate: "2026-09-10",
          payers: [
            { participantId: read.participantId, amount: parsed.amountMinor },
          ],
          splitMethod: "equal",
          splitEntries: read.participants.map(
            (participant: { id: string }) => ({
              participantId: participant.id,
            }),
          ),
        },
      }),
      context(group.groupId),
    );

    expect(written.status).toBe(201);

    const listed = await (
      await expensesRoute.GET(
        call(`/api/groups/${group.groupId}/expenses`, token),
        context(group.groupId),
      )
    ).json();

    expect(listed.expenses[0]).toMatchObject({
      description: "Coop",
      amount: "2450",
      currency: "CHF",
    });
  });

  it("lets a pinned key parse, which is what makes the recipe work at all", async () => {
    // `/api/parse` names no group, and a pinned key is refused every other
    // route that names none. The exception is deliberate and documented; a
    // shortcut holding the narrowest possible key would otherwise be able to
    // file an entry and unable to work out what the sentence said.
    const { token } = await setup();

    const response = await parseRoute.POST(
      call("/api/parse", token, {
        method: "POST",
        body: { text: "12 euros coffee" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("hands back no minor amount when the group's currency is not yet known", async () => {
    // The share-sheet order: parse first, choose the group afterwards. The
    // document tells that caller to convert once it has a currency, and this
    // is the answer it gets in the meantime.
    const { token } = await setup();

    const parsed = await (
      await parseRoute.POST(
        call("/api/parse", token, {
          method: "POST",
          body: { text: "84.20 dinner" },
        }),
      )
    ).json();

    expect(parsed.amountText).toBe("84.20");
    expect(parsed.currency).toBe("");
    expect(parsed.amountMinor).toBeNull();
  });

  it("refuses the write half of the recipe to a read-only key", async () => {
    const owner = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(owner, { name: "Lisbon" });
    const { token } = await createApiToken(owner.userId, {
      name: "Wall tablet",
      scope: "read",
      groupId: group.groupId,
    });

    const response = await expensesRoute.POST(
      call(`/api/groups/${group.groupId}/expenses`, token, {
        method: "POST",
        body: {
          description: "Coop",
          amount: "2450",
          currency: "CHF",
          expenseDate: "2026-09-10",
          payers: [{ participantId: group.ownerParticipantId, amount: "2450" }],
          splitMethod: "equal",
          splitEntries: [{ participantId: group.ownerParticipantId }],
        },
      }),
      context(group.groupId),
    );

    expect(response.status).toBe(403);
  });
});
