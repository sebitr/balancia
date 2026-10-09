import "server-only";
import { z } from "zod";
import {
  authorizeGroup,
  type GroupAccess,
  type UserActor,
} from "@/lib/security/authorization";
import { listGroupsForUser, listParticipants } from "@/modules/groups/service";
import { ToolFailure } from "./support";

/**
 * Names in, ids out.
 *
 * A person says "the Lisbon trip" and "Marta"; the services want UUIDs. The
 * tools take either, because a model that has read the ids from an earlier call
 * should be able to use them, and one that has only the person's words should
 * not have to go and look them up first.
 *
 * Every resolution is ambiguity-averse. A name that fits two things is an error
 * that lists both, never a guess: this resolves who owes whom, and a wrong
 * guess is money moved between the wrong two people.
 */

const uuid = z.uuid();

/** Lower case, accents off, whitespace collapsed — what two spellings share. */
function plain(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The group a reference names, authorized for this actor.
 *
 * A UUID goes straight to `authorizeGroup`, which holds a one-group credential
 * to its group before it fetches anything. A name is looked up among the groups
 * the account is in — and for a pinned credential, among that one — so a name
 * can never reach a group the id could not.
 */
export async function resolveGroup(
  actor: UserActor,
  reference: string,
  options: { requireActive?: boolean } = {},
): Promise<GroupAccess> {
  const ref = reference.trim();
  if (uuid.safeParse(ref).success) {
    return authorizeGroup(actor, ref, options);
  }

  const mine = (await listGroupsForUser(actor.userId)).filter(
    (group) =>
      actor.tokenGroupId === undefined || group.id === actor.tokenGroupId,
  );
  const wanted = plain(ref);
  const exact = mine.filter((group) => plain(group.name) === wanted);
  if (exact.length === 1) {
    return authorizeGroup(actor, exact[0]!.id, options);
  }
  if (exact.length > 1) {
    throw new ToolFailure(
      `More than one group is called "${ref}". Use the id: ${exact
        .map((group) => `${group.name} = ${group.id}`)
        .join("; ")}.`,
    );
  }

  const near = mine.filter((group) => plain(group.name).includes(wanted));
  if (wanted.length >= 3 && near.length === 1) {
    return authorizeGroup(actor, near[0]!.id, options);
  }

  throw new ToolFailure(
    mine.length === 0
      ? "There are no groups this connection can use."
      : `No group matches "${ref}". Groups available: ${mine
          .map((group) => `"${group.name}"`)
          .join(", ")}.`,
  );
}

export interface Person {
  readonly id: string;
  readonly name: string;
}

/** The people currently in the group — the ones an entry may name. */
export async function groupPeople(groupId: string): Promise<Person[]> {
  return (await listParticipants(groupId)).map((member) => ({
    id: member.id,
    name: member.displayName,
  }));
}

/** Everybody the group has ever had, removed members included, for reading. */
export async function everyonePeople(groupId: string): Promise<Person[]> {
  return (await listParticipants(groupId, { includeRemoved: true })).map(
    (member) => ({ id: member.id, name: member.displayName }),
  );
}

const SELF = new Set(["me", "myself", "i", "self", "moi"]);

/**
 * The member a reference names: "me", an id, a name, or an unambiguous first
 * name or prefix of one.
 *
 * "me" is the connected account's own seat in this group — the one thing a
 * name cannot say, since the person's name in the group may not be the one on
 * the account.
 */
export function pickPerson(
  people: readonly Person[],
  reference: string,
  access: Pick<GroupAccess, "participantId">,
  role = "person",
): Person {
  const ref = reference.trim();
  const wanted = plain(ref);

  if (SELF.has(wanted)) {
    const self = people.find((person) => person.id === access.participantId);
    if (!self) {
      throw new ToolFailure(
        'The connected account has no seat in this group, so "me" cannot be used. Name the person instead.',
      );
    }
    return self;
  }

  if (uuid.safeParse(ref).success) {
    const byId = people.find((person) => person.id === ref);
    if (byId) return byId;
  }

  const exact = people.filter((person) => plain(person.name) === wanted);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) throw ambiguous(ref, exact, role);

  const partial = people.filter((person) => {
    const name = plain(person.name);
    // A first name is an exact match; a prefix has to be long enough to mean
    // something. "A" is not an abbreviation of anybody, and the only thing it
    // can do here is pick the wrong person when the group has one name in it.
    return (
      name.split(" ")[0] === wanted ||
      (wanted.length >= 3 && name.startsWith(wanted))
    );
  });
  if (partial.length === 1) return partial[0]!;
  if (partial.length > 1) throw ambiguous(ref, partial, role);

  throw new ToolFailure(
    `No ${role} in this group matches "${ref}". Members: ${people
      .map((person) => `"${person.name}"`)
      .join(", ")}.`,
  );
}

function ambiguous(
  ref: string,
  matches: readonly Person[],
  role: string,
): ToolFailure {
  return new ToolFailure(
    `"${ref}" could be more than one ${role}: ${matches
      .map((person) => `${person.name} (${person.id})`)
      .join("; ")}. Use the id.`,
  );
}
