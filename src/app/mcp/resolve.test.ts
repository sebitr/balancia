import { describe, expect, it } from "vitest";
import { pickPerson } from "./resolve";
import { ToolFailure } from "./support";

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

  it("prefers an exact name to a longer one that starts with it", () => {
    const longer = {
      id: "66666666-6666-4666-8666-666666666666",
      name: "Marta Costa",
    };
    expect(pick("Marta", [ADA, MARTA, longer])).toBe(MARTA);
  });

  it("tells the model who is in the group when nobody fits", () => {
    expect(() => pick("Nobody")).toThrow(/Members: "Ada Lovelace", "Marta"/);
  });
});
