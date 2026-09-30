import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { groupMembers, participants } from "@/lib/db/schema";
import {
  authorizeGroup,
  type GuestActor,
  type UserActor,
} from "@/lib/security/authorization";
import {
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import { createApiToken } from "@/modules/api-tokens/service";
import { createExpense } from "@/modules/expenses/service";
import { createInvitation } from "@/modules/groups/service";
import {
  replacePayoutMethods,
  savePayoutAddress,
} from "@/modules/payouts/service";
import {
  createTestGroup,
  createTestUser,
  isoToday,
  type TestGroup,
} from "../helpers/factories";

/**
 * What a guest link and an API key are shown, against what a person is.
 *
 * Both are bearer credentials that travel: a link gets forwarded, a key gets
 * pasted into somebody else's software. So both are answered with less than
 * the account holder behind them would be — and this file holds the line in
 * the places the answer is actually assembled, the route handlers and the page
 * loaders, rather than in the services, which take an access and trust it.
 *
 * Three rules, each checked against the raw response rather than a field, so
 * that a value which slips out under a new name still fails:
 *
 *  - a guest never reads an email address or an account id, on the web or
 *    over the API;
 *  - a guest who owes somebody reads how to pay them — the IBAN and its
 *    payment code — and nothing more: no postal address as a field, and no
 *    detail of anybody they do not owe;
 *  - a key reads the settle-up transfers and no payout detail at all.
 *
 * The second is also the one test that attacks the payout permission rule
 * directly: a member with an IBAN on file, owed money by somebody else on the
 * same screen, stays out of reach of a reader who does not owe them.
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

// The members page asks for its words and the reader's locale, and there is
// no request here for next-intl to find them in. The keys are enough: what is
// under test is which facts reach the page, not how they are phrased.
vi.mock("next-intl/server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getTranslations: async () => (key: string) => key,
  getLocale: async () => "en",
}));

const groupRoute = await import("@/app/api/groups/[groupId]/route");
const participantsRoute =
  await import("@/app/api/groups/[groupId]/participants/route");
const settleUpRoute =
  await import("@/app/api/groups/[groupId]/settle-up/route");
const { default: SettleUpPage } =
  await import("@/app/groups/[groupId]/settle/page");
const { default: MembersPage } =
  await import("@/app/groups/[groupId]/members/page");

beforeEach(() => {
  cookieActor.value = null;
});

const ADA_IBAN = "DE89370400440532013000";
const BLAISE_IBAN = "GB82WEST12345698765432";
const SWISS_IBAN = "CH9300762011623852957";
const NILS_EMAIL = "nils@example.test";

function context(groupId: string) {
  return { params: Promise.resolve({ groupId }) } as never;
}

function get(path: string, token: string | null = null): Request {
  return new Request(`http://localhost${path}`, {
    headers: token === null ? {} : { Authorization: `Bearer ${token}` },
  });
}

/** A user who joined a group somebody else owns. */
async function addMember(
  group: TestGroup,
  name: string,
): Promise<{ actor: UserActor; participantId: string }> {
  const db = getDb();
  const actor = await createTestUser({
    name,
    email: `${name.toLowerCase()}@example.test`,
  });
  const [participant] = await db
    .insert(participants)
    .values({
      groupId: group.groupId,
      displayName: name,
      email: actor.email,
      userId: actor.userId,
    })
    .returning({ id: participants.id });
  await db.insert(groupMembers).values({
    groupId: group.groupId,
    userId: actor.userId,
    participantId: participant!.id,
    role: "member",
  });
  return { actor, participantId: participant!.id };
}

/** Somebody holding a one-time invitation to one seat. */
async function addGuest(group: TestGroup, name: string): Promise<GuestActor> {
  const [seat] = await getDb()
    .insert(participants)
    .values({ groupId: group.groupId, displayName: name })
    .returning({ id: participants.id });
  const invitation = await createInvitation(group.access, {
    participantId: seat!.id,
  });
  const redeemed = await redeemInvitation(invitation.token);
  const session = await resolveGuestSession(redeemed.token);
  if (!session) throw new Error("Expected a live guest session");
  return {
    kind: "guest",
    groupId: session.groupId,
    participantId: session.participantId,
    displayName: session.displayName,
    sessionId: session.sessionId,
  };
}

/** `payer` paid `amount` cents of euros, and all of it was `owedBy`'s. */
async function spend(
  actor: UserActor | GuestActor,
  groupId: string,
  payer: string,
  owedBy: string,
  amount: string,
) {
  await createExpense(await authorizeGroup(actor, groupId), {
    description: "Dinner",
    notes: "",
    category: "",
    amount,
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: payer, amount }],
    splitMethod: "equal",
    splitEntries: [{ participantId: owedBy }],
  });
}

/**
 * Ada owns the group and Blaise is a member; both have an IBAN on file, and
 * Ada has a postal address too. Grace is on a guest link and Nils is a name
 * with an email Ada typed for him.
 *
 * Grace owes Ada — through an expense Grace recorded herself, "paid by Ada,
 * all of it mine", which is the debt anybody on a link can write. Nils owes
 * Blaise. So Blaise is owed money on the very screen Grace reads, and Grace
 * owes him nothing.
 */
async function scene() {
  const ada = await createTestUser({ name: "Ada", email: "ada@example.test" });
  const group = await createTestGroup(ada, { name: "Lisbon" });
  const blaise = await addMember(group, "Blaise");
  const [nils] = await getDb()
    .insert(participants)
    .values({ groupId: group.groupId, displayName: "Nils", email: NILS_EMAIL })
    .returning({ id: participants.id });
  const grace = await addGuest(group, "Grace");

  await replacePayoutMethods(ada.userId, [
    { method: "bank", detail: ADA_IBAN },
  ]);
  await savePayoutAddress(ada.userId, {
    street: "Rue du Rhône",
    buildingNumber: "12",
    postalCode: "1204",
    town: "Genève",
    country: "CH",
  });
  await replacePayoutMethods(blaise.actor.userId, [
    { method: "bank", detail: BLAISE_IBAN },
  ]);

  await spend(
    grace,
    group.groupId,
    group.ownerParticipantId,
    grace.participantId,
    "5000",
  );
  await spend(
    blaise.actor,
    group.groupId,
    blaise.participantId,
    nils!.id,
    "2000",
  );

  return { ada, group, blaise, grace, nilsId: nils!.id };
}

/** Everything nobody on a guest link should find in anything they are sent. */
function secretsOf(world: Awaited<ReturnType<typeof scene>>) {
  return [
    world.ada.email,
    world.ada.userId,
    world.blaise.actor.email,
    world.blaise.actor.userId,
    NILS_EMAIL,
  ];
}

describe("a guest reading the group over the API", () => {
  it("gets names and whether they sign in, and no address or account id", async () => {
    const world = await scene();
    cookieActor.value = world.grace;

    for (const response of [
      await groupRoute.GET(
        get(`/api/groups/${world.group.groupId}`),
        context(world.group.groupId),
      ),
      await participantsRoute.GET(
        get(`/api/groups/${world.group.groupId}/participants`),
        context(world.group.groupId),
      ),
    ]) {
      expect(response.status).toBe(200);
      const text = await response.text();
      for (const secret of secretsOf(world)) {
        expect(text).not.toContain(secret);
      }

      const people = (JSON.parse(text) as { participants: object[] })
        .participants;
      expect(people).toHaveLength(4);
      for (const person of people) {
        expect(person).not.toHaveProperty("email");
        expect(person).not.toHaveProperty("userId");
      }
      expect(
        Object.fromEntries(
          people.map((person) => {
            const row = person as { displayName: string; hasAccount: boolean };
            return [row.displayName, row.hasAccount];
          }),
        ),
      ).toEqual({ Ada: true, Blaise: true, Nils: false, Grace: false });
    }
  });

  it("leaves a member's copy exactly as it was", async () => {
    const world = await scene();
    cookieActor.value = world.blaise.actor;

    const response = await groupRoute.GET(
      get(`/api/groups/${world.group.groupId}`),
      context(world.group.groupId),
    );
    const { participants: people } = (await response.json()) as {
      participants: Record<string, unknown>[];
    };

    // The shape the native client decodes: the address and the account id,
    // and no `hasAccount` it has never been told about.
    const ada = people.find((person) => person.displayName === "Ada");
    expect(ada).toMatchObject({
      email: world.ada.email,
      userId: world.ada.userId,
    });
    expect(ada).not.toHaveProperty("hasAccount");
    expect(
      people.find((person) => person.displayName === "Nils"),
    ).toMatchObject({ email: NILS_EMAIL, userId: null });
  });
});

describe("a guest settling up", () => {
  it("reads the IBAN and the code of the person they owe, from the route", async () => {
    const world = await scene();
    cookieActor.value = world.grace;

    const response = await settleUpRoute.GET(
      get(`/api/groups/${world.group.groupId}/settle-up`),
      context(world.group.groupId),
    );
    expect(response.status).toBe(200);
    const text = await response.text();
    const { settleUp } = JSON.parse(text) as {
      settleUp: {
        currencies: { others: { toName: string }[] }[];
        payoutHints: {
          participantId: string;
          methods: { method: string; detail: string; qr: unknown }[];
        }[];
      };
    };

    // What the owner decided a guest keeps: enough to pay the person they owe.
    expect(settleUp.payoutHints).toHaveLength(1);
    expect(settleUp.payoutHints[0]).toMatchObject({
      participantId: world.group.ownerParticipantId,
      methods: [
        {
          method: "bank",
          detail: ADA_IBAN,
          qr: { standard: "epc", payload: expect.stringContaining(ADA_IBAN) },
        },
      ],
    });

    // Blaise is owed money on this very screen and has an IBAN on file. The
    // reader does not owe him, so it is not theirs to read.
    expect(settleUp.currencies[0]!.others).toEqual([
      expect.objectContaining({ toName: "Blaise" }),
    ]);
    expect(text).not.toContain(BLAISE_IBAN);

    // Ada's address is on file for the Swiss QR-bill. A German IBAN takes a
    // Girocode, which carries no address, so none of it is anywhere here.
    expect(text).not.toContain("Rhône");
    expect(text).not.toContain("Genève");
    for (const secret of secretsOf(world)) {
      expect(text).not.toContain(secret);
    }
  });

  it("reads the same from the page the web draws", async () => {
    const world = await scene();
    cookieActor.value = world.grace;

    const page = (await SettleUpPage(context(world.group.groupId))) as {
      props: {
        payoutHints: { participantId: string; methods: { detail: string }[] }[];
      };
    };

    expect(page.props.payoutHints).toEqual([
      expect.objectContaining({
        participantId: world.group.ownerParticipantId,
        methods: [expect.objectContaining({ detail: ADA_IBAN })],
      }),
    ]);

    const props = JSON.stringify(page.props);
    expect(props).not.toContain(BLAISE_IBAN);
    expect(props).not.toContain("Rhône");
    for (const secret of secretsOf(world)) {
      expect(props).not.toContain(secret);
    }
  });

  it("carries a Swiss address inside the QR-bill and nowhere else", async () => {
    // The one standard that cannot be built without the creditor's address.
    // The code has to hold it, and a scanned code shows it — but a field that
    // spells it out beside the IBAN would be the address handed over for its
    // own sake.
    const world = await scene();
    await replacePayoutMethods(world.ada.userId, [
      { method: "bank", detail: SWISS_IBAN },
    ]);
    cookieActor.value = world.grace;

    const response = await settleUpRoute.GET(
      get(`/api/groups/${world.group.groupId}/settle-up`),
      context(world.group.groupId),
    );
    const body = (await response.json()) as {
      settleUp: {
        payoutHints: {
          methods: { qr: { standard: string; payload: string } | null }[];
          qr: { standard: string; payload: string } | null;
        }[];
      };
    };
    const [hint] = body.settleUp.payoutHints;

    expect(hint!.methods[0]!.qr?.standard).toBe("swiss");
    expect(hint!.methods[0]!.qr?.payload).toContain("Rue du Rhône");

    const withoutCodes = JSON.stringify({
      ...body.settleUp,
      payoutHints: body.settleUp.payoutHints.map((one) => ({
        ...one,
        qr: null,
        methods: one.methods.map((method) => ({ ...method, qr: null })),
      })),
    });
    expect(withoutCodes).not.toContain("Rhône");
    expect(withoutCodes).not.toContain("Genève");
  });
});

describe("a guest on the members page", () => {
  it("is handed the names and not the addresses", async () => {
    const world = await scene();
    cookieActor.value = world.grace;

    const page = JSON.stringify(
      await MembersPage(context(world.group.groupId)),
    );

    // The rows are there — this is not passing because the list is empty.
    expect(page).toContain("Blaise");
    expect(page).toContain("Nils");
    for (const secret of secretsOf(world)) {
      expect(page).not.toContain(secret);
    }
  });

  it("still shows a member the addresses", async () => {
    const world = await scene();
    cookieActor.value = world.blaise.actor;

    const page = JSON.stringify(
      await MembersPage(context(world.group.groupId)),
    );

    expect(page).toContain(world.ada.email);
    expect(page).toContain(NILS_EMAIL);
  });
});

describe("an API key settling up", () => {
  /** Blaise owes Ada, and Ada has said how to be paid. */
  async function debt() {
    const ada = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(ada, { name: "Flat" });
    const blaise = await addMember(group, "Blaise");
    await replacePayoutMethods(ada.userId, [
      { method: "bank", detail: ADA_IBAN },
    ]);
    await spend(
      ada,
      group.groupId,
      group.ownerParticipantId,
      blaise.participantId,
      "4200",
    );
    return { group, blaise };
  }

  it("shows the member themself how to pay, as it always has", async () => {
    const { group, blaise } = await debt();
    cookieActor.value = blaise.actor;

    const response = await settleUpRoute.GET(
      get(`/api/groups/${group.groupId}/settle-up`),
      context(group.groupId),
    );
    const { settleUp } = (await response.json()) as {
      settleUp: { payoutHints: { methods: { detail: string }[] }[] };
    };

    expect(settleUp.payoutHints).toHaveLength(1);
    expect(settleUp.payoutHints[0]!.methods[0]!.detail).toBe(ADA_IBAN);
  });

  it.each(["read", "write"] as const)(
    "answers a %s key with the same transfers and no payout details",
    async (scope) => {
      const { group, blaise } = await debt();
      const { token } = await createApiToken(blaise.actor.userId, {
        name: "Cron",
        scope,
      });

      const byKey = await settleUpRoute.GET(
        get(`/api/groups/${group.groupId}/settle-up`, token),
        context(group.groupId),
      );
      expect(byKey.status).toBe(200);
      const text = await byKey.text();
      expect(text).not.toContain(ADA_IBAN);
      const keyed = (JSON.parse(text) as { settleUp: Record<string, unknown> })
        .settleUp;
      expect(keyed.payoutHints).toEqual([]);

      // Everything else is what the person behind the key would read.
      cookieActor.value = blaise.actor;
      const bySession = (await (
        await settleUpRoute.GET(
          get(`/api/groups/${group.groupId}/settle-up`),
          context(group.groupId),
        )
      ).json()) as { settleUp: Record<string, unknown> };
      expect({ ...keyed, payoutHints: null }).toEqual({
        ...bySession.settleUp,
        payoutHints: null,
      });
    },
  );
});
