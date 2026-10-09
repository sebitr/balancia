import { describe, expect, it } from "vitest";
import { bundleName, parseBundleName, selectExpired } from "./naming";

/**
 * Retention deletes files in somebody's cloud account. The tests that matter
 * here are the ones about what it must NOT touch.
 */

const at = (iso: string) => new Date(iso);

describe("bundleName", () => {
  it("is sortable, in UTC, to the second", () => {
    expect(bundleName(at("2026-10-09T03:30:12.345Z"))).toBe(
      "balancia-backup-20261009T033012Z.json.gz.age",
    );
  });

  it("reads back to the second it was written", () => {
    const written = at("2026-10-09T03:30:12.000Z");

    expect(parseBundleName(bundleName(written))?.toISOString()).toBe(
      written.toISOString(),
    );
  });
});

describe("parseBundleName", () => {
  it.each([
    "balancia-backup-20261009T033012Z.json.gz.age.bak",
    "balancia-backup-20261009T033012Z.json",
    "my-balancia-backup-20261009T033012Z.json.gz.age",
    "notes.txt",
    "",
    "balancia-backup-99999999T999999Z.json.gz.age",
  ])("does not recognise %j", (name) => {
    expect(parseBundleName(name)).toBeNull();
  });
});

describe("selectExpired", () => {
  const names = [1, 2, 3, 4, 5].map((day) =>
    bundleName(at(`2026-10-0${day}T03:00:00Z`)),
  );

  it("returns the oldest beyond the newest N, oldest first", () => {
    expect(selectExpired(names, 3)).toEqual([names[0], names[1]]);
  });

  it("is order-independent", () => {
    expect(selectExpired([...names].reverse(), 3)).toEqual([
      names[0],
      names[1],
    ]);
  });

  it("deletes nothing while there are no more than N", () => {
    expect(selectExpired(names, 5)).toEqual([]);
    expect(selectExpired(names, 50)).toEqual([]);
  });

  it("never offers a file that is not one of ours", () => {
    const mixed = [
      ...names,
      "README.txt",
      "balancia-backup-20250101T000000Z.json.gz.age.old",
      "photos.zip",
    ];

    const expired = selectExpired(mixed, 1);

    expect(expired).toEqual(names.slice(0, 4));
    expect(expired).not.toContain("README.txt");
  });

  it("refuses a nonsense limit rather than deleting everything", () => {
    expect(selectExpired(names, 0)).toEqual([]);
    expect(selectExpired(names, -1)).toEqual([]);
    expect(selectExpired(names, 1.5)).toEqual([]);
    expect(selectExpired(names, Number.NaN)).toEqual([]);
  });
});
