import { describe, expect, it } from "vitest";
import {
  bundleName,
  destinationTag,
  isListedBy,
  parseBundle,
  parseBundleName,
  selectExpired,
} from "./naming";

/**
 * Retention deletes files in somebody's cloud account. The tests that matter
 * here are the ones about what it must NOT touch — and, since a folder can be
 * shared, whose files it must not touch.
 */

const at = (iso: string) => new Date(iso);

const MINE = destinationTag("3f2a9c1b-7d4e-4a10-9b2c-0e1f2a3b4c5d");
const THEIRS = destinationTag("9e8d7c6b-5a49-4382-a716-151413121110");

describe("destinationTag", () => {
  it("is the first twelve hex digits of the destination's id", () => {
    expect(MINE).toBe("3f2a9c1b7d4e");
  });

  it("refuses anything that is not an id", () => {
    expect(() => destinationTag("not-an-id")).toThrow();
    expect(() => destinationTag("")).toThrow();
  });
});

describe("bundleName", () => {
  it("is sortable, in UTC, to the second, and says which destination wrote it", () => {
    expect(bundleName(at("2026-10-09T03:30:12.345Z"), MINE)).toBe(
      "balancia-backup-3f2a9c1b7d4e-20261009T033012Z.json.gz.age",
    );
  });

  it("reads back to the second it was written, and to the destination", () => {
    const written = at("2026-10-09T03:30:12.000Z");

    expect(parseBundleName(bundleName(written, MINE))?.toISOString()).toBe(
      written.toISOString(),
    );
    expect(parseBundle(bundleName(written, MINE))?.tag).toBe(MINE);
  });

  it("gives two destinations writing in the same second two files", () => {
    const now = at("2026-10-09T03:30:12Z");

    expect(bundleName(now, MINE)).not.toBe(bundleName(now, THEIRS));
  });

  it("will not be given a tag it did not make", () => {
    expect(() => bundleName(at("2026-10-09T03:30:12Z"), "../x")).toThrow();
  });
});

describe("parseBundleName", () => {
  it("still reads a name from before backups carried a tag", () => {
    const legacy = "balancia-backup-20261009T033012Z.json.gz.age";

    expect(parseBundleName(legacy)?.toISOString()).toBe(
      "2026-10-09T03:30:12.000Z",
    );
    expect(parseBundle(legacy)?.tag).toBeNull();
  });

  it.each([
    "balancia-backup-20261009T033012Z.json.gz.age.bak",
    "balancia-backup-20261009T033012Z.json",
    "my-balancia-backup-20261009T033012Z.json.gz.age",
    "notes.txt",
    "",
    "balancia-backup-99999999T999999Z.json.gz.age",
    "balancia-backup-3f2a9c1b7d4e-99999999T999999Z.json.gz.age",
    "balancia-backup-3F2A9C1B7D4E-20261009T033012Z.json.gz.age",
    "balancia-backup-3f2a9c1b-20261009T033012Z.json.gz.age",
    "balancia-backup-3f2a9c1b7d4e-20261009T033012Z.json.gz.age.old",
  ])("does not recognise %j", (name) => {
    expect(parseBundleName(name)).toBeNull();
  });
});

describe("isListedBy", () => {
  const now = at("2026-10-09T03:30:12Z");

  it("offers a destination its own files", () => {
    expect(isListedBy(bundleName(now, MINE), MINE)).toBe(true);
  });

  it("does not offer it another destination's, though they share the folder", () => {
    expect(isListedBy(bundleName(now, THEIRS), MINE)).toBe(false);
  });

  it("offers an untagged file from before tags, which may be the owner's only copy", () => {
    expect(
      isListedBy("balancia-backup-20261009T033012Z.json.gz.age", MINE),
    ).toBe(true);
  });

  it("offers nothing that is not a backup", () => {
    expect(isListedBy("README.txt", MINE)).toBe(false);
  });
});

describe("selectExpired", () => {
  const names = [1, 2, 3, 4, 5].map((day) =>
    bundleName(at(`2026-10-0${day}T03:00:00Z`), MINE),
  );
  const mine = { tag: MINE };

  it("returns the oldest beyond the newest N, oldest first", () => {
    expect(selectExpired(names, 3, mine)).toEqual([names[0], names[1]]);
  });

  it("is order-independent", () => {
    expect(selectExpired([...names].reverse(), 3, mine)).toEqual([
      names[0],
      names[1],
    ]);
  });

  it("deletes nothing while there are no more than N", () => {
    expect(selectExpired(names, 5, mine)).toEqual([]);
    expect(selectExpired(names, 50, mine)).toEqual([]);
  });

  it("never offers a file that is not one of ours", () => {
    const mixed = [
      ...names,
      "README.txt",
      "balancia-backup-20250101T000000Z.json.gz.age.old",
      "photos.zip",
    ];

    const expired = selectExpired(mixed, 1, mine);

    expect(expired).toEqual(names.slice(0, 4));
    expect(expired).not.toContain("README.txt");
  });

  it("never offers, or counts, another destination's backups in the same folder", () => {
    const theirs = [1, 2, 3, 4, 5, 6, 7].map((day) =>
      bundleName(at(`2026-10-0${day}T04:00:00Z`), THEIRS),
    );

    const expired = selectExpired([...theirs, ...names], 3, mine);

    // Their seven newer files do not push any of mine out of my newest three,
    // and none of theirs is mine to delete.
    expect(expired).toEqual([names[0], names[1]]);
    expect(selectExpired([...theirs, ...names], 1, { tag: THEIRS })).toEqual(
      theirs.slice(0, 6),
    );
  });

  it("leaves an untagged file alone unless this destination's history says it wrote it", () => {
    const legacyNames = [1, 2, 3].map(
      (day) => `balancia-backup-2026090${day}T030000Z.json.gz.age`,
    );
    const [oldest = "", middle = ""] = legacyNames;

    // Nobody can say whose these are: none is deleted, and none counts.
    expect(selectExpired([...legacyNames, ...names], 3, mine)).toEqual([
      names[0],
      names[1],
    ]);

    // Its history names two of them: those are its own, oldest of all.
    expect(
      selectExpired([...legacyNames, ...names], 3, {
        tag: MINE,
        legacyOwned: new Set([oldest, middle]),
      }),
    ).toEqual([oldest, middle, names[0], names[1]]);
  });

  it("refuses a nonsense limit rather than deleting everything", () => {
    expect(selectExpired(names, 0, mine)).toEqual([]);
    expect(selectExpired(names, -1, mine)).toEqual([]);
    expect(selectExpired(names, 1.5, mine)).toEqual([]);
    expect(selectExpired(names, Number.NaN, mine)).toEqual([]);
  });

  it("refuses a tag that is not one, rather than matching everything", () => {
    expect(selectExpired(names, 1, { tag: "" })).toEqual([]);
  });
});
