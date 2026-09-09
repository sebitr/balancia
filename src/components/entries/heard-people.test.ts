import { describe, expect, it } from "vitest";
import { heardPeople } from "./heard-people";
import { heardEntry } from "./heard-entry";

/**
 * Reading the people out of a dictated sentence.
 *
 * The failure that matters here is not the one the money parser guards
 * against. A wrong *amount* is a figure nobody said in a field nobody was
 * watching; a wrong *name* is a bill charged to somebody who was not there,
 * and it looks exactly like a bill charged to somebody who was. So almost
 * every test below is about refusing: an unknown name, an ambiguous one, a
 * list with a stranger in it, two payers where the form holds one. Each of
 * those proposes nothing at all and leaves the words where they were said.
 */

const GROUP = [
  { id: "seb", displayName: "Seb" },
  { id: "anna", displayName: "Anna Meier" },
  { id: "jonas", displayName: "Jonas" },
];
const SELF = "seb";

/** The whole sentence, read by both parsers the way the form reads it. */
function heard(spoken: string, members = GROUP, selfId = SELF) {
  const people = heardPeople(spoken, members, selfId);
  const entry = heardEntry(spoken, "CHF", people.spans);
  return {
    payerId: people.payerId,
    participantIds: people.participantIds,
    amountText: entry.amountText,
    description: entry.description,
  };
}

describe("the brief's own sentence", () => {
  /*
   * Four facts used to be thrown away here — a payer, two people and the
   * split between them — and the two that were kept came back with the rest
   * of the sentence sitting in the description.
   */
  it("hears a payer, two people, an amount and what it was for", () => {
    expect(heard("Anna paid the 120 taxi, split with me and Jonas")).toEqual({
      payerId: "anna",
      participantIds: ["seb", "jonas"],
      amountText: "120",
      description: "taxi",
    });
  });

  it("says the same thing in French", () => {
    expect(heard("Anna a payé le taxi 120 francs, partagé avec moi et Jonas"))
      .toEqual({
        payerId: "anna",
        participantIds: ["seb", "jonas"],
        amountText: "120",
        description: "taxi",
      });
  });
});

describe("who paid", () => {
  it.each([
    ["Anna paid 30 francs for the taxi", "anna"],
    ["Anna Meier paid 30 francs for the taxi", "anna"],
    ["30 francs taxi paid by Anna", "anna"],
    ["Anna a payé 45 euros au restaurant", "anna"],
    ["45 euros au restaurant payé par Anna", "anna"],
    ["Jonas réglé 20 francs café", "jonas"],
  ])("hears the payer in %s", (spoken, payerId) => {
    expect(heard(spoken).payerId).toBe(payerId);
  });

  it("takes the clause out of what the money was for", () => {
    expect(heard("Anna paid 30 francs for the taxi").description).toBe("taxi");
    // The article the verb left behind goes with it — but only where it is
    // grammar. Half the shopfronts in France open with one.
    expect(heard("Anna a payé le taxi 120 francs").description).toBe("taxi");
    expect(heard("Anna a payé La Poste 12 euros").description).toBe("La Poste");
    expect(heard("30 francs taxi paid by Anna").description).toBe("taxi");
    expect(heard("Anna a payé 45 euros au restaurant").description).toBe(
      "restaurant",
    );
  });

  /*
   * The group is the whole of the lookup. Nothing here matches the *shape* of
   * a name, so a recogniser that heard "Klaus" where nobody said it proposes
   * nobody — and the words it misheard stay on screen, where the reader can
   * see what it thought it heard.
   */
  it("proposes nobody for a name this group does not have", () => {
    expect(heard("Klaus paid 30 francs for the taxi")).toEqual({
      payerId: "",
      participantIds: [],
      amountText: "30",
      description: "Klaus paid for the taxi",
    });
  });

  it("proposes nobody when the name could be two people", () => {
    // Resolving this by roster order would be a wrong name wearing a right
    // one's clothes: on screen it is indistinguishable from a correct guess.
    const twoAnnas = [
      { id: "seb", displayName: "Seb" },
      { id: "anna", displayName: "Anna Meier" },
      { id: "anna2", displayName: "Anna Roth" },
    ];
    expect(heardPeople("Anna paid the taxi", twoAnnas, SELF).payerId).toBe("");
    // The full name is still hers, because two words tell them apart.
    expect(heardPeople("Anna Roth paid the taxi", twoAnnas, SELF).payerId).toBe(
      "anna2",
    );
  });

  /*
   * Two payers is a panel with an amount against each name, not a chip. Half
   * of it — Jonas alone, holding the whole bill — would be a quiet lie, so
   * the sentence proposes nobody and keeps its words.
   */
  it("proposes nobody when two people paid", () => {
    expect(heard("Anna et Jonas ont payé le taxi 120 francs")).toEqual({
      payerId: "",
      participantIds: [],
      amountText: "120",
      description: "Anna et Jonas ont payé le taxi",
    });
    expect(heard("120 francs taxi paid by Anna and Jonas").payerId).toBe("");
  });
});

describe("who shares it", () => {
  it("puts the speaker in when the sentence says 'with'", () => {
    // "split it with Anna" is two people. Nobody says "with Anna and me".
    expect(heard("dinner 60 francs split with Anna").participantIds).toEqual([
      "seb",
      "anna",
    ]);
    expect(heard("dîner 60 francs partagé avec Anna").participantIds).toEqual([
      "seb",
      "anna",
    ]);
  });

  /*
   * And leaves them out when it says "between". "Split between Anna and
   * Jonas" is a bill the speaker pays no part of, and adding them to it
   * silently would move real money.
   */
  it("leaves the speaker out when the sentence says 'between'", () => {
    expect(
      heard("120 francs taxi split between Anna and Jonas").participantIds,
    ).toEqual(["anna", "jonas"]);
    expect(
      heard("120 francs taxi partagé entre Anna et Jonas").participantIds,
    ).toEqual(["anna", "jonas"]);
  });

  it("hears the people without a verb in front of them", () => {
    expect(heard("dinner 60 francs with Anna").participantIds).toEqual([
      "seb",
      "anna",
    ]);
    expect(heard("dinner 60 francs with Anna").description).toBe("dinner");
  });

  it("reads a list however it was punctuated", () => {
    expect(
      heard("120 francs taxi split between Anna, Jonas and me").participantIds,
    ).toEqual(["seb", "anna", "jonas"]);
  });

  it("answers in roster order, whatever order they were said in", () => {
    expect(
      heard("120 francs taxi split between Jonas and Anna").participantIds,
    ).toEqual(["anna", "jonas"]);
  });

  /*
   * The rule this file exists to keep. A list that quietly drops the member
   * it could not place would halve a bill and say nothing: the split row
   * would show one name, which is a thing the reader might have meant.
   */
  it("proposes nobody when one name in the list is a stranger", () => {
    expect(heard("40 francs dinner split with me and Klaus")).toEqual({
      payerId: "",
      participantIds: [],
      amountText: "40",
      description: "dinner split with me and Klaus",
    });
  });

  it("proposes nobody for words that only look like a list", () => {
    expect(heard("5 francs coffee with milk").participantIds).toEqual([]);
    expect(heard("5 francs coffee with milk").description).toBe(
      "coffee with milk",
    );
  });

  it.each([
    "20 francs lunch just me",
    "20 francs lunch only me",
    "20 francs déjeuner juste moi",
    "20 francs déjeuner que moi",
    "20 francs déjeuner moi seul",
  ])("hears 'just me' in %s", (spoken) => {
    expect(heard(spoken).participantIds).toEqual(["seb"]);
  });

  it("takes 'just me' out of what the money was for", () => {
    expect(heard("20 francs lunch just me").description).toBe("lunch");
  });
});

describe("what it leaves alone", () => {
  it("hears nobody where there is no roster to hear them in", () => {
    expect(heardPeople("Anna paid the taxi", [], "")).toEqual({
      payerId: "",
      participantIds: [],
      spans: [],
    });
  });

  it("says nothing about an empty sentence", () => {
    expect(heardPeople("   ", GROUP, SELF)).toEqual({
      payerId: "",
      participantIds: [],
      spans: [],
    });
  });

  /*
   * Every sentence the money parser was measured against still reads the
   * same way through a full roster. "Gift for Marie" is a present, not a
   * split — "for" says who it is *for*, and this file only ever reads who it
   * is *with*.
   */
  it.each([
    ["gift for Marie 40 euros", "gift for Marie"],
    ["cadeau pour Marie 40 euros", "cadeau pour Marie"],
    ["dîner chez Pierre 80 francs", "dîner chez Pierre"],
    ["24 francs Coop", "Coop"],
    ["I paid 30 euros for the train", "train"],
  ])("leaves %s to the money parser", (spoken, description) => {
    const marie = [...GROUP, { id: "marie", displayName: "Marie" }];
    expect(heard(spoken, marie).description).toBe(description);
    expect(heard(spoken, marie).payerId).toBe("");
    expect(heard(spoken, marie).participantIds).toEqual([]);
  });

  it("leaves the description exactly as it was when it read nobody", () => {
    // No clause resolved, so nothing was cut and nothing is tidied — not even
    // the comma, which is still doing the work it was said for.
    expect(heardEntry("40 francs dinner, drinks and pizza", "CHF")).toEqual(
      heardEntry("40 francs dinner, drinks and pizza", "CHF", []),
    );
  });
});
