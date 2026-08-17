import { describe, expect, it } from "vitest";
import type { PersonView } from "./people-card";
import { inReadingOrder } from "./reading-order";

/**
 * The order of the People list, which is the order two roles and then the
 * alphabet put it in — never the order people happened to be added.
 */

function person(id: string, name: string, isOwner = false): PersonView {
  return {
    id,
    name,
    email: "",
    isOwner,
    access: "none",
    link: null,
    balances: [],
  };
}

const names = (people: readonly PersonView[]) =>
  people.map((person) => person.name);

describe("inReadingOrder", () => {
  it("puts you first, the owner next, then the rest by name", () => {
    const people = [
      person("cyril", "Cyril"),
      person("herve", "hervé"),
      person("seb", "Seb", true),
      person("me", "Amélie"),
    ];

    expect(names(inReadingOrder(people, "me", "fr"))).toEqual([
      "Amélie",
      "Seb",
      "Cyril",
      "hervé",
    ]);
  });

  it("gives the owner the top row when they are the one reading", () => {
    const people = [person("cyril", "Cyril"), person("seb", "Seb", true)];

    // One row, not two: being both the reader and the owner is one rank.
    expect(names(inReadingOrder(people, "seb", "fr"))).toEqual([
      "Seb",
      "Cyril",
    ]);
  });

  it("leads with the owner for a reader who has no row of their own", () => {
    const people = [person("cyril", "Cyril"), person("seb", "Seb", true)];

    expect(names(inReadingOrder(people, null, "fr"))).toEqual(["Seb", "Cyril"]);
  });

  it("sorts by the letter, not by the accent or the case", () => {
    const people = [
      person("a", "Zoé"),
      person("b", "adrien"),
      person("c", "Émile"),
      person("d", "Elias"),
    ];

    expect(names(inReadingOrder(people, null, "fr"))).toEqual([
      "adrien",
      "Elias",
      "Émile",
      "Zoé",
    ]);
  });

  it("leaves the list it was given alone", () => {
    const people = [person("b", "Blaise"), person("a", "Amélie")];
    inReadingOrder(people, null, "fr");

    expect(names(people)).toEqual(["Blaise", "Amélie"]);
  });
});
