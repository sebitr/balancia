import { describe, expect, it } from "vitest";
import { heardEntry } from "./heard-entry";

/**
 * Turning a spoken sentence into three fields.
 *
 * The failure that matters is not "it heard the wrong shop" — the reader sees
 * and fixes that. It is a sentence that produces a *number* nobody said, or
 * loses the words that say what the money was for.
 */

describe("what it hears", () => {
  it("takes the brief's own example", () => {
    expect(heardEntry("add 24 francs Coop")).toEqual({
      amountText: "24",
      currency: "CHF",
      description: "Coop",
    });
  });

  it("reads decimals said either way", () => {
    expect(heardEntry("12.50 euros bakery").amountText).toBe("12.50");
    expect(heardEntry("12,50 euros bakery").amountText).toBe("12.50");
  });

  /*
   * The grouped thousand is the one that mattered most to get right. A plain
   * run of digits matched "1" out of "1,500" and handed the form a rent of
   * one franc — a figure nobody said, in a field nobody was watching, which
   * is this parser's own definition of the failure that counts.
   *
   * Which mark groups and which divides is a locale's business, and dictation
   * has no locale. What separates them is the length of the last group: three
   * digits behind the final mark is a thousand, one or two is a decimal.
   */
  it.each([
    ["1,500 euros rent", "1500"],
    ["1.500 euros loyer", "1500"],
    ["1 500 euros loyer", "1500"],
    ["2,499.99 dollars laptop", "2499.99"],
    ["2.499,99 euros ordinateur", "2499.99"],
    ["12,505 francs voiture", "12505"],
  ])("reads the grouped figure in %s", (spoken, amountText) => {
    expect(heardEntry(spoken).amountText).toBe(amountText);
  });

  it("does not leave a grouped thousand in the description", () => {
    expect(heardEntry("1 500 euros loyer").description).toBe("loyer");
  });

  /*
   * Said aloud, cents follow the unit: "vingt-quatre euros cinquante". The
   * figure used to come out as 24 with a stray "50" heading the description.
   */
  it.each([
    ["24 euros 50 lunch", "24.50", "lunch"],
    ["12 francs 80 café", "12.80", "café"],
  ])("hears the cents in %s", (spoken, amountText, description) => {
    expect(heardEntry(spoken)).toEqual({
      amountText,
      currency: expect.any(String),
      description,
    });
  });

  it("does not mistake a count after the unit for cents", () => {
    // A single digit is not how anybody says cents, and "3 beers" is not
    // three centimes.
    expect(heardEntry("10 euros 3 beers").amountText).toBe("10");
    expect(heardEntry("10 euros 3 beers").description).toBe("3 beers");
  });

  it("does not add cents to a figure that already has them", () => {
    expect(heardEntry("12,50 euros 30 people").amountText).toBe("12.50");
  });

  it("keeps the description when there is no amount", () => {
    expect(heardEntry("coffee with Hervé")).toEqual({
      amountText: "",
      currency: "",
      description: "coffee with Hervé",
    });
  });

  it("keeps the amount when there is nothing else", () => {
    expect(heardEntry("42")).toEqual({
      amountText: "42",
      currency: "",
      description: "",
    });
  });

  it("says nothing about an empty sentence", () => {
    expect(heardEntry("   ")).toEqual({
      amountText: "",
      currency: "",
      description: "",
    });
  });
});

describe("the currency", () => {
  it("understands the words people say", () => {
    expect(heardEntry("8 balles café").currency).toBe("CHF");
    expect(heardEntry("8 quid lunch").currency).toBe("GBP");
    expect(heardEntry("8 bucks lunch").currency).toBe("USD");
  });

  it("understands a code a recogniser wrote out", () => {
    expect(heardEntry("30 EUR train").currency).toBe("EUR");
  });

  /*
   * A Swiss recogniser writes francs the way a till receipt does. Asked for
   * "restaurant 50 francs" it returns "restaurant 50 fr.", and the dot is
   * folded off before anything is matched while "fr" is two letters short of
   * an ISO code — so the abbreviation fell through every rule here and the
   * description came back as "restaurant fr." with the group's own currency
   * left on the figure.
   */
  it.each([
    ["restaurant 50 fr.", "restaurant"],
    ["restaurant 50 fr", "restaurant"],
    ["restaurant 50 frs", "restaurant"],
    ["restaurant 50 Fr.", "restaurant"],
    ["50 sfr Coop", "Coop"],
  ])("reads the Swiss abbreviation in %s", (spoken, description) => {
    expect(heardEntry(spoken)).toEqual({
      amountText: "50",
      currency: "CHF",
      description,
    });
  });

  /*
   * Dictating money is exactly where a recogniser writes the sign instead of
   * the word — "30 €" for "trente euros", and closed up in front in English.
   * Reading only the words missed all of these and quietly left the group's
   * own currency on an amount that was said in another one.
   */
  it.each([
    ["$24 Coop", "USD"],
    ["24$ Coop", "USD"],
    ["€30 train", "EUR"],
    ["30€ train", "EUR"],
    ["24 € Coop", "EUR"],
    ["£8 lunch", "GBP"],
  ])("reads the sign in %s", (spoken, currency) => {
    expect(heardEntry(spoken).currency).toBe(currency);
  });

  it("keeps the sign out of the description and the amount", () => {
    expect(heardEntry("$24 Coop")).toEqual({
      amountText: "24",
      currency: "USD",
      description: "Coop",
    });
    expect(heardEntry("24 € Coop").description).toBe("Coop");
  });

  it("falls back to the group's rather than to none", () => {
    // A sentence with no currency in it does not mean "no currency".
    expect(heardEntry("30 train", "CHF").currency).toBe("CHF");
    expect(heardEntry("30 euros train", "CHF").currency).toBe("EUR");
  });

  it("takes the currency word out of the description", () => {
    expect(heardEntry("24 francs Coop Genève").description).toBe("Coop Genève");
  });

  it("leaves a three-letter word that is not a currency alone", () => {
    expect(heardEntry("12 cat food")).toEqual({
      amountText: "12",
      currency: "",
      description: "cat food",
    });
  });
});

describe("the words around it", () => {
  it("drops the scaffolding at the front", () => {
    expect(heardEntry("add 24 francs Coop").description).toBe("Coop");
    // Only from the front, and only while it keeps finding them — but it has
    // to find all of them: an article in the middle of the run used to stop
    // the stripping dead and leave "une dépense de" sitting in the field.
    expect(heardEntry("ajoute une dépense de 24 francs Coop").description).toBe(
      "Coop",
    );
  });

  /*
   * People narrate rather than command. Every one of these used to keep its
   * own opening words, so the description read "I paid for the train".
   */
  it.each([
    ["I paid 30 euros for the train", "train"],
    ["I spent 8 pounds on lunch", "lunch"],
    ["log 15 dollars taxi", "taxi"],
    ["j'ai payé 30 euros pour le train", "train"],
    ["on a payé 45 euros au restaurant", "restaurant"],
    ["dépense de 18 euros pizza", "pizza"],
  ])("keeps only what the money was for in %s", (spoken, description) => {
    expect(heardEntry(spoken).description).toBe(description);
  });

  it("only drops a joining word once there is an amount to join", () => {
    // Nothing parsed, so the words come back as they were said rather than
    // being tidied into something nobody asked for.
    expect(heardEntry("coffee for the office").description).toBe(
      "coffee for the office",
    );
  });

  /*
   * Half the shopfronts in France open with an article, and so do plenty in
   * English. Stripping one off the head of a description turned Le Gruyère
   * into Gruyère — so an article only leaves in a preposition's wake, and a
   * capital mid-sentence is taken for the name it almost always is.
   */
  it.each([
    ["12 euros La Poste", "La Poste"],
    ["20 euros Le Gruyère", "Le Gruyère"],
    ["18 euros Chez Pierre", "Chez Pierre"],
    ["15 dollars The Bagel Store", "The Bagel Store"],
    ["24 francs Coop Genève", "Coop Genève"],
  ])("keeps the name in %s", (spoken, description) => {
    expect(heardEntry(spoken).description).toBe(description);
  });

  it("still drops the joining words that are only grammar", () => {
    expect(heardEntry("30 euros pour le train").description).toBe("train");
    expect(heardEntry("12 euros au restaurant").description).toBe("restaurant");
  });

  it("keeps a scaffolding word that is doing real work", () => {
    // "note" only introduces an entry at the front of a sentence.
    expect(heardEntry("12 francs note book").description).toBe("note book");
  });

  it("finds no amount at all in a long run of digits", () => {
    // A phone number is not an amount, and picking eight digits out of the
    // middle of one would put a figure in the field that nobody said.
    expect(heardEntry("call 0041791234567").amountText).toBe("");
    expect(heardEntry("call 0041791234567").description).toBe(
      "call 0041791234567",
    );
  });
});

/**
 * The sentences people actually say, in both languages the app ships.
 *
 * Written after a sweep of a hundred-odd realistic transcripts found the
 * reader losing in four different ways at once. A table rather than prose
 * because the failures were never in one rule — they were in the collisions
 * between them, and a collision is only visible next to the case it breaks.
 */
describe("what people actually say", () => {
  it.each([
    // The commonest shape of all: what it was, then what it cost.
    ["coffee 5 francs", "5", "CHF", "coffee"],
    ["lunch 20 euros", "20", "EUR", "lunch"],
    ["groceries 45.50 francs", "45.50", "CHF", "groceries"],
    ["rent 1200 francs", "1200", "CHF", "rent"],
    ["movie tickets 30 francs", "30", "CHF", "movie tickets"],
    ["gift for Marie 40 euros", "40", "EUR", "gift for Marie"],
    ["electricity bill 120 francs", "120", "CHF", "electricity bill"],
    // Cost first.
    ["24 francs Coop", "24", "CHF", "Coop"],
    ["12 euros for coffee", "12", "EUR", "coffee"],
    // Narrated rather than commanded.
    ["I paid 30 euros for the train", "30", "EUR", "train"],
    ["I spent 15 on groceries", "15", "", "groceries"],
    ["we spent 60 francs at the market", "60", "CHF", "market"],
    ["I bought coffee for 5 francs", "5", "CHF", "bought coffee"],
    // No unit said at all: the group's own currency is left alone.
    ["coffee 5", "5", "", "coffee"],
    ["groceries 45.50", "45.50", "", "groceries"],
  ])("hears %s", (spoken, amountText, currency, description) => {
    expect(heardEntry(spoken)).toEqual({ amountText, currency, description });
  });

  it.each([
    ["restaurant 50 francs", "50", "CHF", "restaurant"],
    ["café 5 francs", "5", "CHF", "café"],
    ["courses 45 francs", "45", "CHF", "courses"],
    ["loyer 1200 francs", "1200", "CHF", "loyer"],
    ["billets de train 120 francs", "120", "CHF", "billets de train"],
    ["cadeau pour Marie 40 euros", "40", "EUR", "cadeau pour Marie"],
    ["abonnement Netflix 15,90 francs", "15.90", "CHF", "abonnement Netflix"],
    ["50 francs de courses", "50", "CHF", "courses"],
    ["80 francs au restaurant", "80", "CHF", "restaurant"],
    ["j'ai dépensé 30 francs en courses", "30", "CHF", "courses"],
    ["on a payé 45 euros au restaurant", "45", "EUR", "restaurant"],
    ["une pizza 18 euros", "18", "EUR", "pizza"],
    ["20 balles pour le ciné", "20", "CHF", "ciné"],
    ["pain au chocolat 3 francs", "3", "CHF", "pain au chocolat"],
    ["dîner chez Pierre 80 francs", "80", "CHF", "dîner chez Pierre"],
  ])("entend %s", (spoken, amountText, currency, description) => {
    expect(heardEntry(spoken)).toEqual({ amountText, currency, description });
  });

  /*
   * People count things out loud, and the count comes first because that is
   * the order the words go in. Taking the first figure made "2 coffees 8
   * francs" an expense of two francs described as "coffees 8" — so the figure
   * is read from the unit stuck to it rather than from its place in the line.
   */
  it.each([
    ["2 coffees 8 francs", "8", "2 coffees"],
    ["3 beers 15 euros", "15", "3 beers"],
    ["2 train tickets 90 francs", "90", "2 train tickets"],
    ["2 cafés 8 francs", "8", "2 cafés"],
    ["4 pizzas 72 euros", "72", "4 pizzas"],
    ["dinner for 4 people 120 francs", "120", "dinner for 4 people"],
    ["12/03 dinner 45 francs", "45", "12/03 dinner"],
    ["2 nuits hôtel 240 francs", "240", "2 nuits hôtel"],
  ])("takes the figure the unit is on in %s", (spoken, amountText, description) => {
    expect(heardEntry(spoken).amountText).toBe(amountText);
    expect(heardEntry(spoken).description).toBe(description);
  });

  it("still reads a unit that came first", () => {
    expect(heardEntry("CHF 24 Coop")).toEqual({
      amountText: "24",
      currency: "CHF",
      description: "Coop",
    });
  });

  /*
   * Switzerland groups thousands with an apostrophe, and this is a Swiss app
   * with francs for a default. A rent dictated as "1'200 francs" was read as
   * two hundred.
   */
  it.each([
    ["loyer 1'200 francs", "1200"],
    ["maison 1'234'567 francs", "1234567"],
    ["loyer 1'200.50 francs", "1200.50"],
  ])("reads the Swiss grouping in %s", (spoken, amountText) => {
    expect(heardEntry(spoken).amountText).toBe(amountText);
  });

  /*
   * Three-letter words are cheap and the ISO list is long. Every one of these
   * is a currency somewhere, and folding case before the lookup let the word
   * take the currency — which then left the real unit sitting in the
   * description, because it had already been claimed.
   */
  it.each([
    ["coffee cup 5 francs", "CHF", "coffee cup"],
    ["top up 20 francs", "CHF", "top up"],
    ["mad hatter 40 euros", "EUR", "mad hatter"],
    ["gel douche 8 francs", "CHF", "gel douche"],
    ["sos plombier 90 francs", "CHF", "sos plombier"],
  ])("does not take the word %s for a currency code", (spoken, currency, description) => {
    expect(heardEntry(spoken).currency).toBe(currency);
    expect(heardEntry(spoken).description).toBe(description);
  });

  it("still takes a code that was written as one", () => {
    expect(heardEntry("courses 45 CHF").currency).toBe("CHF");
    expect(heardEntry("30 EUR train").currency).toBe("EUR");
  });

  it("takes the word for the cents along with the cents", () => {
    expect(heardEntry("50 francs 20 centimes")).toEqual({
      amountText: "50.20",
      currency: "CHF",
      description: "",
    });
    // "cent" is a hundred everywhere it is not two digits behind a unit.
    expect(heardEntry("cent balles").description).toBe("cent");
  });
});
