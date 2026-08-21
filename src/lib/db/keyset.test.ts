import { describe, expect, it } from "vitest";
import { compareKeysDesc, decodeCursor, encodeCursor } from "./keyset";

/**
 * The cursor is the only thing standing between a paged list and a row shown
 * twice, so these tests are about the two ways it can quietly fail: losing
 * precision on the way through the URL, and ordering keys differently from the
 * `ORDER BY` the database was given.
 */

const KEY = {
  date: "2019-07-02",
  time: "2019-07-02T10:00:00.123456Z",
  id: "0f5c2f5e-8c8e-4c1e-9b2a-3b7d1c9e4a11",
};

describe("cursor encoding", () => {
  it("comes back exactly as it went in, microseconds and all", () => {
    expect(decodeCursor(encodeCursor(KEY))).toEqual(KEY);
  });

  it("survives being carried as a query parameter", () => {
    const params = new URLSearchParams({ cursor: encodeCursor(KEY) });
    const read = new URLSearchParams(params.toString()).get("cursor");
    expect(decodeCursor(read)).toEqual(KEY);
  });

  it("refuses anything it did not write", () => {
    // Every one of these would otherwise reach the database as a parameter.
    expect(decodeCursor(null)).toBeNull();
    expect(decodeCursor("")).toBeNull();
    expect(decodeCursor("nonsense")).toBeNull();
    // A time rounded to milliseconds is the failure this is really guarding:
    // accepted, it would skip every row inside the microsecond it dropped.
    expect(
      decodeCursor(`${KEY.date}|2019-07-02T10:00:00.123Z|${KEY.id}`),
    ).toBeNull();
    expect(decodeCursor(`${KEY.date}|${KEY.time}|not-a-uuid`)).toBeNull();
    expect(decodeCursor(`02/07/2019|${KEY.time}|${KEY.id}`)).toBeNull();
  });
});

describe("key ordering", () => {
  it("puts the later date first", () => {
    const older = { ...KEY, date: "2019-07-01" };
    expect(compareKeysDesc(KEY, older)).toBeLessThan(0);
    expect(compareKeysDesc(older, KEY)).toBeGreaterThan(0);
  });

  it("falls back to the clock, then to the id", () => {
    const earlier = { ...KEY, time: "2019-07-02T09:00:00.000000Z" };
    expect(compareKeysDesc(KEY, earlier)).toBeLessThan(0);

    // Same date and same microsecond — an import writes hundreds like this,
    // and the id is the only thing left to order them by.
    const lowerId = { ...KEY, id: "0a5c2f5e-8c8e-4c1e-9b2a-3b7d1c9e4a11" };
    expect(compareKeysDesc(KEY, lowerId)).toBeLessThan(0);
    expect(compareKeysDesc(lowerId, KEY)).toBeGreaterThan(0);
  });

  it("calls a key equal to itself", () => {
    expect(compareKeysDesc(KEY, { ...KEY })).toBe(0);
  });

  it("sorts a mixed list the way the database would", () => {
    const keys = [
      { date: "2019-07-02", time: "2019-07-02T10:00:00.000001Z", id: "b" },
      { date: "2022-03-04", time: "2022-03-04T08:00:00.000000Z", id: "a" },
      { date: "2019-07-02", time: "2019-07-02T10:00:00.000002Z", id: "c" },
    ];
    expect([...keys].sort(compareKeysDesc).map((key) => key.id)).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
});
