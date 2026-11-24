import "server-only";
import { z } from "zod";
import {
  authorizeGroup,
  type GroupAccess,
  type UserActor,
} from "@/lib/security/authorization";
import { listGroupsForUser, listParticipants } from "@/modules/groups/service";
import { shown, ToolFailure } from "./support";

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
 *
 * **An exact name does not beat a longer one that contains it.** The groups an
 * account is in include ones somebody else made, and anybody can call theirs
 * "Lisbon". A person who says "add dinner to Lisbon" and means "Lisbon trip
 * 2026" would otherwise have the dinner, its amount and a notification land in
 * a group whose owner chose the name to catch exactly that. So every group the
 * words could mean is a candidate, the exact one included, and more than one is
 * refused with every id.
 *
 * Reads are held to the same rule as changes. A read is where a model learns
 * the ids it writes with — `balancia_get_group` is the call it is told to make
 * before recording anything — and an id goes straight through, so a read
 * answered from the wrong group is a change sent to it one call later.
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
  const choices = (groups: typeof mine) =>
    groups.map((group) => `${shown(group.name)} = ${group.id}`).join("; ");

  const exact = mine.filter((group) => plain(group.name) === wanted);
  if (exact.length > 1) {
    throw new ToolFailure(
      `More than one group is called "${shown(ref)}". Nothing was changed. Ask the person which they mean, then use the id: ${choices(exact)}.`,
    );
  }

  const candidates = mine.filter((group) => {
    const name = plain(group.name);
    // The whole name, its first word, or — when the words are long enough to
    // mean something — any part of it.
    return (
      name === wanted ||
      name.split(" ")[0] === wanted ||
      (wanted.length >= 3 && name.includes(wanted))
    );
  });
  if (candidates.length === 1) {
    return authorizeGroup(actor, candidates[0]!.id, options);
  }
  if (candidates.length > 1) {
    throw new ToolFailure(
      `"${shown(ref)}" could be more than one group: ${choices(candidates)}. Nothing was changed. Ask the person which they mean, then use the id.`,
    );
  }

  throw new ToolFailure(
    mine.length === 0
      ? "There are no groups this connection can use."
      : `No group matches "${shown(ref)}". Groups available: ${mine
          .map((group) => `"${shown(group.name)}"`)
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
 *
 * **An exact name does not beat a longer one that starts with it.** Anybody
 * with a group's join link picks their own name, so a guest can arrive as
 * "Ben" in a group where Ben Carter is owed money — and if "Ben" went to
 * whoever is called exactly that, "Ben paid me back" would be recorded against
 * the guest. Every member the words could mean is a candidate, and two or more
 * are refused with their ids, so the assistant has to ask.
 *
 * An id is taken only as the id of somebody in the group. One that is not is
 * refused rather than read as a name, since a display name can be any text —
 * a removed member's id included.
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
    const byId = people.find(
      (person) => person.id.toLowerCase() === ref.toLowerCase(),
    );
    if (byId) return byId;
    throw new ToolFailure(
      `Nobody in this group has the id ${ref}. Members: ${people
        .map((person) => `"${shown(person.name)}" (${person.id})`)
        .join(", ")}.`,
    );
  }

  const candidates = people.filter((person) => {
    const name = plain(person.name);
    // A first name counts in full; a prefix has to be long enough to mean
    // something. "A" is not an abbreviation of anybody, and the only thing it
    // can do here is pick the wrong person when the group has one name in it.
    return (
      name === wanted ||
      name.split(" ")[0] === wanted ||
      (wanted.length >= 3 && name.startsWith(wanted))
    );
  });
  if (candidates.length === 1) return candidates[0]!;
  if (candidates.length > 1) throw ambiguous(ref, candidates, role);

  throw new ToolFailure(
    `No ${role} in this group matches "${shown(ref)}". Members: ${people
      .map((person) => `"${shown(person.name)}"`)
      .join(", ")}.`,
  );
}

function ambiguous(
  ref: string,
  matches: readonly Person[],
  role: string,
): ToolFailure {
  const listed = matches
    .map((person) => `${shown(person.name)} (${person.id})`)
    .join("; ");
  return new ToolFailure(
    `"${shown(ref)}" could be more than one ${role}: ${listed}. Nothing was changed. Ask the person which they mean, then use the id.`,
  );
}
