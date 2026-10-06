import { describe, expect, it } from "vitest";
import en from "../../../../../messages/en.json";
import fr from "../../../../../messages/fr.json";
import { importRunStatusEnum } from "@/lib/db/schema/imports";

/**
 * Every status an import can be stored in has a word on both screens that
 * list imports.
 *
 * The group's import page used to look each one up and print the stored value
 * when the catalogue had no entry — and the catalogue had entries for two of
 * the six, plus two values the column has never held. So a run caught
 * mid-import read `importing`, in English, under a French heading. The page
 * no longer falls back, which makes a missing word a type error in English;
 * this is what catches it in French, and on the settings screen that lists
 * the same runs.
 */

const STATUSES = importRunStatusEnum.enumValues;

describe("import statuses", () => {
  it.each([
    ["en", "importPage.status", en.importPage.status],
    ["fr", "importPage.status", fr.importPage.status],
    ["en", "userSettings.importStatus", en.userSettings.importStatus],
    ["fr", "userSettings.importStatus", fr.userSettings.importStatus],
  ])("%s %s names exactly the stored statuses", (_locale, _path, words) => {
    expect(Object.keys(words).sort()).toEqual([...STATUSES].sort());
    for (const status of STATUSES) {
      const word = (words as Record<string, string>)[status];
      expect(word.trim(), status).not.toBe("");
      // A word, not the code's value read back.
      expect(word, status).not.toBe(status);
    }
  });

  it("says the same word for a status on both screens", () => {
    for (const status of STATUSES) {
      expect(en.importPage.status[status]).toBe(
        en.userSettings.importStatus[status],
      );
      expect(fr.importPage.status[status]).toBe(
        fr.userSettings.importStatus[status],
      );
    }
  });
});
