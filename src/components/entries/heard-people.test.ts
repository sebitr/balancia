import { describe, expect, it } from "vitest";
import { heardPeople } from "./heard-people";
import { heardEntry } from "./heard-entry";

/**
 * Reading the people out of a dictated sentence.
 *
 * The failure that matters here is not the one the money parser guards
 * against. A wrong *amount* is a figure nobody said in a field nobody was
 * watching; a wrong *name* is a bill charged to somebody who was not there,
 * and it looks exactly like a bill charged to somebody who was. So a good
 * half of what is below is about refusing: an unknown name, an ambiguous one,
 * a list with a stranger in it, two payers where the form holds one. Each of
 * those proposes nothing at all and leaves the words where they were said.
 *
 * The corpus at the foot of this file is the other half, and it is the more
 * useful one. Written from a sweep of a hundred realistic transcripts in both
 * languages rather than from the inside — which is how every vocabulary list
 * in `heard-entry.ts` was got wrong the first time — it started at 44 of 74
 * and found seven separate faults, none of them in a single rule. It lives
 * here rather than in a scratch script because the value was never the one
 * run: it is the table.
 */

const GROUP = [
  { id: "seb", displayName: "Seb" },
  { id: "anna", displayName: "Anna Meier" },
  { id: "jonas", displayName: "Jonas" },
  { id: "herve", displayName: "Hervé" },
  { id: "marie", displayName: "Marie" },
];
const SELF = "seb";
const EVERYONE = "seb+anna+jonas+herve+marie";

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

/** The same, flattened the way the corpus tables below write it out. */
function read(spoken: string) {
  const { payerId, participantIds, description } = heard(spoken);
  return {
    payer: payerId,
    split: participantIds.join("+"),
    description,
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
    expect(
      heard("Anna a payé le taxi 120 francs, partagé avec moi et Jonas"),
    ).toEqual({
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
    expect(heard("30 francs taxi paid by Anna").description).toBe("taxi");
    // The article the verb left behind goes with it — but only where it is
    // grammar. Half the shopfronts in France open with one.
    expect(heard("Anna a payé le taxi 120 francs").description).toBe("taxi");
    expect(heard("Anna a payé La Poste 12 euros").description).toBe("La Poste");
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

  /*
   * A comma is punctuation far more often than it is enumeration, and holding
   * it to the same standard as an "and" cost the sweep four sentences: "split
   * the bill with Anna and Jonas, 90 francs" ends its list at the comma and
   * goes on with the money. So a comma closes the list — unless what follows
   * was *written as a name*, which is a person the roster could not place.
   */
  it("tells a comma that ends a list from one that hides a stranger", () => {
    expect(
      heard("split the bill with Anna and Jonas, 90 francs").participantIds,
    ).toEqual(["seb", "anna", "jonas"]);
    expect(
      heard("60 francs dinner shared with Anna, Klaus and Jonas")
        .participantIds,
    ).toEqual([]);
  });

  it("proposes nobody for words that only look like a list", () => {
    expect(heard("5 francs coffee with milk").participantIds).toEqual([]);
    expect(heard("5 francs coffee with milk").description).toBe(
      "coffee with milk",
    );
  });

  /*
   * "for" is the one marker that has to earn it. A gift for Marie is not a
   * split with Marie, and what tells the two apart is the speaker being in
   * the list alongside somebody else — nobody buys themselves a present.
   */
  it("reads 'for' as a split only where the speaker is in it", () => {
    expect(heard("coffee 8 francs for me and Anna").participantIds).toEqual([
      "seb",
      "anna",
    ]);
    expect(heard("gift for Marie 40 euros").participantIds).toEqual([]);
    expect(heard("gift for Marie 40 euros").description).toBe("gift for Marie");
    expect(heard("coffee 8 francs for me").participantIds).toEqual([]);
  });

  it.each([
    "20 francs lunch just me",
    "20 francs lunch only me",
    "20 francs déjeuner juste moi",
    "20 francs déjeuner que moi",
    "45 francs courses rien que moi",
    "20 francs café moi tout seul",
  ])("hears 'just me' in %s", (spoken) => {
    expect(heard(spoken).participantIds).toEqual(["seb"]);
  });

  it("takes 'just me' out of what the money was for", () => {
    expect(heard("20 francs lunch just me").description).toBe("lunch");
    expect(heard("45 francs courses rien que moi").description).toBe("courses");
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

  it("cuts nothing out for a clause that resolved to nobody", () => {
    // "Split between everyone" in a group of nobody. The words would have
    // gone for a proposal that never arrived.
    expect(heardPeople("60 francs split between everyone", [], "")).toEqual({
      payerId: "",
      participantIds: [],
      spans: [],
    });
  });

  /*
   * Every sentence the money parser was measured against still reads the same
   * way through a full roster — including the shopfronts, which is what the
   * capital is for.
   */
  it.each([
    ["cadeau pour Marie 40 euros", "cadeau pour Marie"],
    ["dîner chez Pierre 80 francs", "dîner chez Pierre"],
    ["24 francs Coop", "Coop"],
    ["12 euros La Poste", "La Poste"],
    ["20 euros Le Gruyère", "Le Gruyère"],
    ["15 dollars The Bagel Store", "The Bagel Store"],
    ["abonnement Netflix 15,90 francs", "abonnement Netflix"],
    ["billets de train 120 francs", "billets de train"],
    ["call 0041791234567", "call 0041791234567"],
  ])("leaves %s to the money parser", (spoken, description) => {
    expect(heard(spoken).description).toBe(description);
    expect(heard(spoken).payerId).toBe("");
    expect(heard(spoken).participantIds).toEqual([]);
  });

  /*
   * The reader naming themselves is read like any other name, and then costs
   * nothing: they are already the payer the form opened on, so the form has
   * nothing to offer and shows no chip. What matters is that the narration
   * still leaves the description alone.
   */
  it.each([
    ["I paid 30 euros for the train", "train"],
    ["paid by me, 30 francs taxi", "taxi"],
    ["réglé par moi, 30 francs pharmacie", "pharmacie"],
  ])("hears the speaker as themselves in %s", (spoken, description) => {
    expect(heard(spoken).payerId).toBe(SELF);
    expect(heard(spoken).description).toBe(description);
  });

  it("leaves the description exactly as it was when it read nobody", () => {
    // No clause resolved, so nothing was cut and nothing is tidied — not even
    // the comma, which is still doing the work it was said for.
    expect(heardEntry("40 francs dinner, drinks and pizza", "CHF")).toEqual(
      heardEntry("40 francs dinner, drinks and pizza", "CHF", []),
    );
  });
});

/**
 * The sentences people actually say, in both languages the app ships.
 *
 * A table rather than prose because the seven faults the sweep found were
 * never in one rule — they were collisions between them, and a collision is
 * only visible next to the case it breaks. The ones worth naming:
 *
 * **Almost nobody says "pay".** They say Anna *got* the coffees, Jonas
 * *covered* the taxi, Anna *a offert* the round, Hervé *is paying*. Thirteen
 * of the seventy-four failed on the verb alone.
 *
 * **A comma before a name is not a list.** "dinner 80 francs, Anna paid"
 * proposed nobody, because the guard that stops "Anna et Jonas ont payé"
 * naming Jonas alone was reading any comma as an enumeration. It now asks
 * whether a *name* ends where the list would have had to start.
 *
 * **French rarely puts a name next to its verb.** "c'est Anna qui a payé",
 * "Jonas a tout payé", "Anna nous a payé le taxi" — three words in between,
 * and every one of them was a wall.
 *
 * **English says the people first.** "Anna and I split the taxi" has no
 * marker at all, and neither does "Anna et moi avons partagé le taxi". Two
 * names or more, then the verb: one name would be "Anna split the bill",
 * which says who did the dividing and not who it was divided between.
 *
 * **The split verb is not next to the marker.** French puts the object
 * between them — "on a partagé le taxi avec Anna" — and the taxi in the
 * middle is the one word that has to survive. The verb is claimed on its own
 * wherever it sits, which is also what turns "split the bill with Anna" into
 * a bill rather than into "split the bill".
 *
 * **People say "everyone" far more often than they list the group.**
 *
 * **A comma at the end of a list is the sentence carrying on.** "split the
 * bill with Anna and Jonas, 90 francs" was demanding a fourth name.
 */
describe("what people actually say", () => {
  it.each([
    // Who paid, said the dozen ways English says it.
    ["Anna paid for dinner 80 francs", "anna", "", "dinner"],
    ["dinner 80 francs, Anna paid", "anna", "", "dinner"],
    ["Anna Meier paid the 200 rent", "anna", "", "rent"],
    ["paid by Anna, 35 francs pharmacy", "anna", "", "pharmacy"],
    ["Jonas covered the taxi 40 francs", "jonas", "", "taxi"],
    ["Anna spent 40 francs on drinks", "anna", "", "drinks"],
    ["Anna bought the coffees 12 francs", "anna", "", "coffees"],
    ["Anna got the coffees 12 francs", "anna", "", "coffees"],
    ["Hervé is paying the 40 francs taxi", "herve", "", "taxi"],
    ["the taxi was 40 francs, Anna covered it", "anna", "", "taxi was"],
    // Who shares it.
    ["split 60 francs between Anna and me", "", "seb+anna", ""],
    ["split the 60 francs bill with Anna", "", "seb+anna", "bill"],
    [
      "split the bill with Anna and Jonas, 90 francs",
      "",
      "seb+anna+jonas",
      "bill",
    ],
    [
      "60 francs dinner shared with Anna and Jonas",
      "",
      "seb+anna+jonas",
      "dinner",
    ],
    ["dinner with Anna and Jonas 90 francs", "", "seb+anna+jonas", "dinner"],
    ["taxi 30 francs with Hervé", "", "seb+herve", "taxi"],
    ["50 francs Coop with Anna", "", "seb+anna", "Coop"],
    ["the 60 francs dinner was split with Anna", "", "seb+anna", "dinner"],
    ["split equally with Anna and Jonas 90 francs", "", "seb+anna+jonas", ""],
    ["we split the 80 francs dinner with Anna", "", "seb+anna", "dinner"],
    // The people first, with no marker anywhere.
    ["Anna and I split the 50 francs taxi", "", "seb+anna", "taxi"],
    ["me and Anna split the 40 francs taxi", "", "seb+anna", "taxi"],
    ["Jonas and Anna split the 80 francs dinner", "", "anna+jonas", "dinner"],
    [
      "Anna Meier and Jonas split the 90 francs hotel",
      "",
      "anna+jonas",
      "hotel",
    ],
    [
      "Anna and Jonas are splitting the 60 francs dinner",
      "",
      "anna+jonas",
      "dinner",
    ],
    ["hotel 200 francs, Anna and Jonas only", "", "anna+jonas", "hotel"],
    // Everybody.
    ["90 francs dinner split with everyone", "", EVERYONE, "dinner"],
    ["Jonas paid, split between everyone, 90 francs", "jonas", EVERYONE, ""],
    [
      "Marie paid for the 45 francs cake for everyone",
      "marie",
      EVERYONE,
      "cake",
    ],
    // And the refusals, in the same table so they read beside what they cost.
    ["Klaus paid 24 francs Coop", "", "", "Klaus paid Coop"],
    ["everyone paid 20 francs", "", "", "everyone paid"],
    ["split it three ways 90 francs", "", "", "split it three ways"],
    ["dinner 60 francs, Anna and me", "", "", "dinner Anna and me"],
    ["hotel 200 francs, Anna and Jonas", "", "", "hotel Anna and Jonas"],
  ])("hears %s", (spoken, payer, split, description) => {
    expect(read(spoken)).toEqual({ payer, split, description });
  });

  it.each([
    // Qui a payé.
    ["Anna a payé 45 euros au restaurant", "anna", "", "restaurant"],
    ["45 euros au restaurant payé par Anna", "anna", "", "restaurant"],
    ["réglé par Hervé, 30 francs pharmacie", "herve", "", "pharmacie"],
    ["c'est Anna qui a payé, 60 francs", "anna", "", ""],
    ["80 francs restaurant, Anna a payé", "anna", "", "restaurant"],
    ["Hervé a réglé l'addition 75 francs", "herve", "", "l'addition"],
    ["Anna paye le resto 40 francs", "anna", "", "resto"],
    ["Anna a offert le café 8 francs", "anna", "", "café"],
    ["Jonas a tout payé, 90 francs", "jonas", "", ""],
    ["Anna nous a payé le taxi 30 francs", "anna", "", "taxi"],
    ["l'hôtel 200 francs réglé par Anna", "anna", "", "l'hôtel"],
    ["le taxi c'est Anna qui paye, 30 francs", "anna", "", "le taxi"],
    // Qui partage.
    ["on a partagé le taxi 40 francs avec Anna", "", "seb+anna", "taxi"],
    ["40 francs taxi partagé entre Anna et moi", "", "seb+anna", "taxi"],
    [
      "dîner 90 francs partagé avec Anna et Jonas",
      "",
      "seb+anna+jonas",
      "dîner",
    ],
    [
      "partagé entre Anna, Jonas et moi 120 francs hôtel",
      "",
      "seb+anna+jonas",
      "hôtel",
    ],
    ["50 francs de courses partagées avec Anna", "", "seb+anna", "courses"],
    ["20 balles pour le ciné avec Jonas", "", "seb+jonas", "ciné"],
    ["Anna et moi avons partagé le taxi 50 francs", "", "seb+anna", "taxi"],
    ["Anna et moi on a partagé le taxi 50 francs", "", "seb+anna", "taxi"],
    ["Anna et Hervé partagent le taxi 40 francs", "", "anna+herve", "taxi"],
    ["on partage avec Anna, 30 francs", "", "seb+anna", ""],
    ["moitié-moitié avec Anna 50 francs", "", "seb+anna", "moitié-moitié"],
    ["dîner à deux avec Anna 60 francs", "", "seb+anna", "dîner à deux"],
    // Tout le monde.
    ["90 francs dîner partagé avec tout le monde", "", EVERYONE, "dîner"],
    ["partagé entre nous tous, 60 francs", "", EVERYONE, ""],
    ["Anna a payé pour tout le monde, 120 francs", "anna", EVERYONE, ""],
    // Les deux à la fois.
    [
      "Anna a payé le loyer 1200 francs partagé entre Anna, Jonas et moi",
      "anna",
      "seb+anna+jonas",
      "loyer",
    ],
  ])("entend %s", (spoken, payer, split, description) => {
    expect(read(spoken)).toEqual({ payer, split, description });
  });

  /*
   * Sentences whose *money* the parser next door is still learning to read —
   * "3 beers 15 euros" takes the count for the price, and "50/50" is a figure
   * before it is a fraction. Both are fixed on the branch this one follows,
   * so only the people are asserted here rather than encoding a number that
   * is about to change.
   */
  it.each([
    ["3 beers 15 euros with Jonas", "seb+jonas"],
    ["split it 50/50 with Anna, 40 francs", "seb+anna"],
  ])("hears the people in %s whatever the figure does", (spoken, split) => {
    expect(heard(spoken).participantIds.join("+")).toBe(split);
  });

  it("hears the payer in a sentence the money parser trips on", () => {
    // "en" joins the joining words on the branch this one follows; until it
    // does, the description keeps it. The payer is the part under test.
    expect(heard("Anna a dépensé 40 francs en boissons").payerId).toBe("anna");
  });
});
