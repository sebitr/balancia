import { describe, expect, it } from "vitest";
import { DEFAULT_TONE, DRAFTS, draftsOf, pickDraft } from "./messages";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

describe("the message library", () => {
  it("holds forty drafts across three tones", () => {
    expect(DRAFTS).toHaveLength(40);
    expect(draftsOf("gentle")).toHaveLength(14);
    expect(draftsOf("dry")).toHaveLength(14);
    expect(draftsOf("cheeky")).toHaveLength(12);
  });

  it("gives every draft a key of its own", () => {
    expect(new Set(DRAFTS.map((draft) => draft.key)).size).toBe(DRAFTS.length);
  });

  it("defaults to the tone that assumes nothing", () => {
    expect(DEFAULT_TONE).toBe("gentle");
  });

  it("has a translated sentence for every key, in both languages", () => {
    for (const draft of DRAFTS) {
      expect(
        en.remind.drafts[draft.key as keyof typeof en.remind.drafts],
        `en: ${draft.key}`,
      ).toBeTypeOf("string");
      expect(
        fr.remind.drafts[draft.key as keyof typeof fr.remind.drafts],
        `fr: ${draft.key}`,
      ).toBeTypeOf("string");
    }
  });

  /**
   * The copy rule the feature rests on: the debt asks, not the person. A draft
   * that named the sender would turn a reminder into an accusation, so no
   * draft may interpolate anything but the three agreed facts.
   */
  it("never lets a draft say who did the reminding", () => {
    const allowed = new Set(["name", "amount", "group"]);
    for (const draft of DRAFTS) {
      const sentence = en.remind.drafts[
        draft.key as keyof typeof en.remind.drafts
      ] as string;
      const used = [...sentence.matchAll(/\{(\w+)\}/g)].map(
        (match) => match[1],
      );
      for (const placeholder of used) {
        expect(allowed.has(placeholder), `${draft.key}: {${placeholder}}`).toBe(
          true,
        );
      }
    }
  });

  /**
   * A reroll may land on any draft in the tone, so every one of them has to
   * carry the whole message on its own: what is owed, and to whom. A draft
   * missing either reads as a riddle to the person who receives it.
   */
  it("names the amount and the person owed, in every draft and both languages", () => {
    for (const draft of DRAFTS) {
      for (const [locale, catalogue] of [
        ["en", en],
        ["fr", fr],
      ] as const) {
        const sentence = catalogue.remind.drafts[
          draft.key as keyof typeof en.remind.drafts
        ] as string;
        expect(sentence, `${locale}: ${draft.key} names the amount`).toContain(
          "{amount}",
        );
        expect(sentence, `${locale}: ${draft.key} names the payee`).toContain(
          "{name}",
        );
      }
    }
  });
});

describe("shuffling", () => {
  it("stays inside the chosen tone", () => {
    const pool = draftsOf("cheeky").length;
    for (let roll = 0; roll < pool; roll += 1) {
      const draft = pickDraft("cheeky", null, () => roll / pool);
      expect(draft.tone).toBe("cheeky");
    }
  });

  /**
   * Shuffling to the sentence already on screen reads as a broken button, so
   * the current draft is removed from the pool rather than filtered after the
   * fact — which would sometimes silently do nothing.
   */
  it("never hands back the draft already showing", () => {
    const current = draftsOf("gentle")[0].key;
    // Every position in the pool, including the one the current draft used to
    // occupy, must land on something else.
    const remaining = draftsOf("gentle").length - 1;
    for (let index = 0; index < remaining; index += 1) {
      const draft = pickDraft("gentle", current, () => index / remaining);
      expect(draft.key).not.toBe(current);
    }
  });

  it("cannot run off the end of the pool when the roll returns 1", () => {
    const draft = pickDraft("dry", null, () => 1);
    expect(draftsOf("dry")).toContainEqual(draft);
  });
});
