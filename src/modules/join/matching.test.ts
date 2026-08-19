import { describe, expect, it } from "vitest";
import {
  editDistance,
  normalizeName,
  scoreName,
  suggestMatch,
} from "./matching";

const GROUP = [
  { id: "jonas", name: "Jonas Thévenot" },
  { id: "marta", name: "Marta Ruiz" },
  { id: "ravi", name: "Ravi Shah" },
];

describe("normalizeName", () => {
  it("folds accents so a plain keyboard reaches an accented name", () => {
    expect(normalizeName("Thévenot")).toBe("thevenot");
    expect(normalizeName("Amélie")).toBe("amelie");
  });

  it("drops apostrophes and punctuation", () => {
    expect(normalizeName("O'Neill")).toBe("oneill");
    expect(normalizeName("Jean-Luc")).toBe("jean luc");
  });

  it("collapses whitespace", () => {
    expect(normalizeName("  Marta   Ruiz ")).toBe("marta ruiz");
  });
});

describe("editDistance", () => {
  it("counts single edits", () => {
    expect(editDistance("marta", "marte")).toBe(1);
    expect(editDistance("ruiz", "ruis")).toBe(1);
  });

  it("is zero for identical strings and full length against empty", () => {
    expect(editDistance("ravi", "ravi")).toBe(0);
    expect(editDistance("ravi", "")).toBe(4);
  });
});

describe("scoreName", () => {
  it("scores a first name alone as a full match", () => {
    expect(scoreName("Jonas", "Jonas Thévenot")).toBe(1);
  });

  it("matches a surname typed without its accent", () => {
    expect(scoreName("thevenot", "Jonas Thévenot")).toBe(1);
  });

  it("counts only what was typed, so a dropped surname is not a miss", () => {
    expect(scoreName("Jonas", "Jonas Thévenot")).toBe(1);
  });

  it("penalises a typed surname the stored name does not have", () => {
    // The asymmetry is the point: it is what makes a full name pick the full
    // row rather than the bare first-name one.
    expect(scoreName("Jonas Thévenot", "Jonas")).toBe(0.5);
  });

  it("tolerates a typo in a long token", () => {
    expect(scoreName("Thevenott", "Jonas Thévenot")).toBeGreaterThan(0.8);
  });

  it("refuses to fuzzy-match short tokens", () => {
    // One edit apart, but three letters is not enough word to misspell.
    expect(scoreName("Rav", "Ravi Shah")).toBeLessThan(1);
    expect(scoreName("Bob", "Ravi Shah")).toBe(0);
  });

  it("treats a shortening as a strong match", () => {
    expect(scoreName("Seb", "Sebastien Trosset")).toBeGreaterThan(0.9);
  });

  it("scores unrelated names at zero", () => {
    expect(scoreName("Wilhelmina", "Ravi Shah")).toBe(0);
  });
});

describe("suggestMatch", () => {
  it("finds the obvious candidate", () => {
    expect(suggestMatch("Jonas", GROUP)?.candidate.id).toBe("jonas");
  });

  it("finds it from the surname, accents ignored", () => {
    expect(suggestMatch("thevenot", GROUP)?.candidate.id).toBe("jonas");
  });

  it("finds it through a typo", () => {
    expect(suggestMatch("Marte Ruiz", GROUP)?.candidate.id).toBe("marta");
  });

  it("suggests nobody when nothing is close", () => {
    expect(suggestMatch("Wilhelmina Krause", GROUP)).toBeNull();
  });

  it("suggests nobody before there is enough to go on", () => {
    expect(suggestMatch("", GROUP)).toBeNull();
    expect(suggestMatch("J", GROUP)).toBeNull();
  });

  it("suggests nobody when two candidates are equally close", () => {
    // Claiming the wrong one hands over somebody else's history, so an
    // ambiguous match falls back to the full list rather than guessing.
    const twins = [
      { id: "a", name: "Jonas Thévenot" },
      { id: "b", name: "Jonas Thevenet" },
    ];
    expect(suggestMatch("Jonas", twins)).toBeNull();
  });

  it("lets an exactly typed name settle a near-twin", () => {
    const twins = [
      { id: "a", name: "Jonas Thévenot" },
      { id: "b", name: "Jonas Thevenet" },
    ];
    expect(suggestMatch("Jonas Thévenot", twins)?.candidate.id).toBe("a");
    expect(suggestMatch("jonas thevenot", twins)?.candidate.id).toBe("a");
  });

  it("suggests nobody when two rows carry the same name", () => {
    const duplicates = [
      { id: "a", name: "Marta Ruiz" },
      { id: "b", name: "Marta Ruiz" },
    ];
    expect(suggestMatch("Marta Ruiz", duplicates)).toBeNull();
  });

  it("picks the full row over the bare first name", () => {
    const both = [
      { id: "short", name: "Jonas" },
      { id: "full", name: "Jonas Thévenot" },
    ];
    expect(suggestMatch("Jonas Thévenot", both)?.candidate.id).toBe("full");
  });

  it("still picks a winner when one is clearly ahead", () => {
    const twins = [
      { id: "a", name: "Jonas Thévenot" },
      { id: "b", name: "Marta Ruiz" },
    ];
    expect(suggestMatch("Jonas Thévenot", twins)?.candidate.id).toBe("a");
  });

  it("suggests nobody from an empty group", () => {
    expect(suggestMatch("Jonas", [])).toBeNull();
  });
});
