import type { PersonView } from "./people-card";

/**
 * You, then the owner, then everyone else by name.
 *
 * Join order — what the query returns — is an accident of history that nobody
 * reading the list is holding in their head. The two rows that are looked up by
 * role rather than by name go to the top: your own, because it is the one whose
 * settings you can actually change, and the owner's, because that is who to ask
 * about the rest. Below them, a name is found by spelling it.
 *
 * Collated rather than compared: `sensitivity: "base"` is what puts "hervé"
 * where "herve" belongs and keeps a lowercase name out of the cellar.
 */
export function inReadingOrder(
  people: readonly PersonView[],
  viewerId: string | null,
  locale: string,
): PersonView[] {
  const rank = (person: PersonView) =>
    person.id === viewerId ? 0 : person.isOwner ? 1 : 2;
  const collator = new Intl.Collator(locale, { sensitivity: "base" });

  return [...people].sort(
    (a, b) => rank(a) - rank(b) || collator.compare(a.name, b.name),
  );
}
