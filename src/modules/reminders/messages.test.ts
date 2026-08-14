import { describe, expect, it } from "vitest";
import {
  DEFAULT_TONE,
  DRAFTS,
  draftsOf,
  pickDraft,
  positionOf,
} from "./messages";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";

describe("the message library", () => {
  it("holds twenty drafts across three tones", () => {
    expect(DRAFTS).toHaveLength(20);
    expect(draftsOf("gentle")).toHaveLength(7);
    expect(draftsOf("dry")).toHaveLength(7);
    expect(draftsOf("cheeky")).toHaveLength(6);
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

  it("numbers a draft by its place in the whole library", () => {
    expect(positionOf(DRAFTS[0].key)).toBe(1);
    expect(positionOf(DRAFTS[19].key)).toBe(20);
  });
});

describe("shuffling", () => {
  it("stays inside the chosen tone", () => {
    for (let roll = 0; roll < 7; roll += 1) {
      const draft = pickDraft("cheeky", null, () => roll / 7);
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
    for (let index = 0; index < 6; index += 1) {
      const draft = pickDraft("gentle", current, () => index / 6);
      expect(draft.key).not.toBe(current);
    }
  });

  it("cannot run off the end of the pool when the roll returns 1", () => {
    const draft = pickDraft("dry", null, () => 1);
    expect(draftsOf("dry")).toContainEqual(draft);
  });
});
