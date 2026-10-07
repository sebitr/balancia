import type {
  ActivityAction,
  ActivityEntry,
  ActivityMetadata,
} from "./service";

/**
 * Reading the log as a person would: one entry for one act.
 *
 * Kept apart from the service so the rule can be exercised on plain objects,
 * without a database behind it.
 */

/** What a folded entry was before it became another kind of entry. */
export interface ReplacedEntry {
  readonly action: ActivityAction;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly metadata: ActivityMetadata | null;
}

const CREATIONS: ReadonlySet<ActivityAction> = new Set([
  "expense.created",
  "settlement.created",
]);
const REMOVALS: ReadonlySet<ActivityAction> = new Set([
  "expense.deleted",
  "settlement.deleted",
]);

/** Whether two events were written by the same person. */
function sameActor(a: ActivityEntry, b: ActivityEntry): boolean {
  if (a.actorParticipantId !== null || b.actorParticipantId !== null) {
    return a.actorParticipantId === b.actorParticipantId;
  }
  return a.actorLabel === b.actorLabel;
}

/**
 * Folds each change of an entry's type into one entry.
 *
 * "Turn this expense into a repayment" is one thing to the person who does it,
 * and two events to the log: the repayment is created and the expense is
 * deleted, in one transaction, so that the money is never counted twice and
 * never missing. Listed as they were written the pair read as an unrelated
 * repayment and an unrelated deletion — and, since both carried the same
 * instant, in whichever order the database happened to return them.
 *
 * The deletion names its replacement (`replacedBy`), so the pair is found by
 * that. Deletions written before it was recorded name nothing, and are paired
 * only when the evidence is unmistakable: the same person, the same
 * millisecond, the other kind of entry, and exactly one candidate on each side.
 *
 * Whatever is not half of a pair, including a half whose partner is not in
 * `entries`, is left as it is. The deletion's own words are carried on the
 * creation as `replaces`, and the deletion leaves the list.
 */
export function foldConversions(
  entries: readonly ActivityEntry[],
): ActivityEntry[] {
  const creations = new Map<string, ActivityEntry>();
  for (const entry of entries) {
    if (CREATIONS.has(entry.action) && entry.entityId) {
      creations.set(entry.entityId, entry);
    }
  }

  // creation event id -> the deletion it replaces
  const replaced = new Map<string, ActivityEntry>();
  // deletion event ids that have been folded into a creation
  const folded = new Set<string>();

  const pair = (creation: ActivityEntry, removal: ActivityEntry): void => {
    replaced.set(creation.id, removal);
    folded.add(removal.id);
  };

  const unlinked: ActivityEntry[] = [];
  for (const entry of entries) {
    if (!REMOVALS.has(entry.action)) continue;
    const replacedBy = entry.metadata?.replacedBy;
    if (typeof replacedBy !== "string") {
      unlinked.push(entry);
      continue;
    }
    const creation = creations.get(replacedBy);
    if (
      creation &&
      creation.entityType !== entry.entityType &&
      !replaced.has(creation.id)
    ) {
      pair(creation, entry);
    }
  }

  for (const removal of unlinked) {
    const candidates = entries.filter(
      (entry) =>
        CREATIONS.has(entry.action) &&
        entry.entityType !== removal.entityType &&
        !replaced.has(entry.id) &&
        entry.createdAt.getTime() === removal.createdAt.getTime() &&
        sameActor(entry, removal),
    );
    const [only] = candidates;
    if (candidates.length !== 1 || !only) continue;
    // The same evidence read from the other side: the creation must not have
    // more than one deletion it could belong to.
    const rivals = unlinked.filter(
      (other) =>
        other.entityType !== only.entityType &&
        other.createdAt.getTime() === only.createdAt.getTime() &&
        sameActor(other, only),
    );
    if (rivals.length === 1) pair(only, removal);
  }

  return entries
    .filter((entry) => !folded.has(entry.id))
    .map((entry) => {
      const removal = replaced.get(entry.id);
      if (!removal) return entry;
      return {
        ...entry,
        replaces: {
          action: removal.action,
          entityType: removal.entityType,
          entityId: removal.entityId,
          metadata: removal.metadata,
        },
      };
    });
}
