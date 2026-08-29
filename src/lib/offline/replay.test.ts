import { describe, expect, it } from "vitest";
import { backoffMs, classifyStatus, isDue } from "./replay";

/**
 * What happens to somebody's expense when the server answers.
 *
 * Every case here is a real evening: four expenses typed at dinner in a place
 * with no signal, and the phone finding a network again at some point that
 * night. The queue has exactly two ways to be wrong — losing an entry, or
 * writing it twice — and the classification below is where the first one would
 * happen. So the tests are written as "does this drop the entry", not as a
 * table of status codes.
 */

describe("classifyStatus", () => {
  it("treats a created expense as written", () => {
    // Also what a replay gets: the route answers 201 with the id it made the
    // first time. The queue cannot tell the two apart and does not need to —
    // both mean the server has the entry exactly once.
    expect(classifyStatus(201)).toEqual({ kind: "written" });
  });

  it("treats a plain 200 as written too", () => {
    // Not what this server sends today. Accepted because "already done" is
    // conventionally 200, and the queue must not be the reason an entry is
    // sent a third time if something in front of the route ever answers that.
    expect(classifyStatus(200)).toEqual({ kind: "written" });
  });

  it("keeps the entry when the session has expired", () => {
    // The case that would hurt most. A phone that has been offline for hours
    // very often has a session that timed out, so 401 is the *likeliest*
    // greeting a reconnecting flush gets — and treating it as a refusal would
    // throw away the evening at the moment the reader signs back in.
    expect(classifyStatus(401)).toEqual({ kind: "retry" });
  });

  it("keeps the entry when the server is rate limiting", () => {
    expect(classifyStatus(429)).toEqual({ kind: "retry" });
  });

  it("keeps the entry when the server is broken", () => {
    expect(classifyStatus(500)).toEqual({ kind: "retry" });
    expect(classifyStatus(502)).toEqual({ kind: "retry" });
  });

  it("keeps the entry on a status it has never heard of", () => {
    // A proxy, a captive portal, a future version of the API. None of them are
    // evidence about the expense, so none of them may discard it.
    expect(classifyStatus(418)).toEqual({ kind: "retry" });
    expect(classifyStatus(0)).toEqual({ kind: "retry" });
  });

  it("blocks when the group is gone or no longer readable", () => {
    // 404 is also what a removed participant produces, because the mobile API
    // answers "not found" to every authorization failure on purpose.
    expect(classifyStatus(404)).toEqual({
      kind: "blocked",
      reason: "noAccess",
    });
    expect(classifyStatus(403)).toEqual({
      kind: "blocked",
      reason: "noAccess",
    });
  });

  it("blocks when the server understood the entry and refused it", () => {
    expect(classifyStatus(422)).toEqual({ kind: "blocked", reason: "refused" });
  });

  it("never answers anything but written, retry or blocked", () => {
    // A fourth verdict added without a home in `flushOutbox` would silently
    // fall through its `if` chain and leave the entry queued forever without
    // ever being retried.
    for (let status = 0; status <= 599; status += 1) {
      expect(["written", "retry", "blocked"]).toContain(
        classifyStatus(status).kind,
      );
    }
  });
});

describe("backoffMs", () => {
  it("does not wait before the first attempt", () => {
    expect(backoffMs(0)).toBe(0);
  });

  it("backs off geometrically", () => {
    expect(backoffMs(1)).toBe(5_000);
    expect(backoffMs(2)).toBe(15_000);
    expect(backoffMs(3)).toBe(45_000);
  });

  it("stops at two minutes however long it has been failing", () => {
    // The ceiling matters more than the growth. What is waiting is a person's
    // expenses, and the visible cost of a long wait is a group that goes on
    // showing the wrong total.
    expect(backoffMs(10)).toBe(120_000);
    expect(backoffMs(1000)).toBe(120_000);
  });
});

describe("isDue", () => {
  it("sends an entry that has never been tried straight away", () => {
    expect(isDue({ attempts: 0, lastAttemptAt: null }, 1_000)).toBe(true);
  });

  it("holds an entry back until its backoff has passed", () => {
    const entry = { attempts: 1, lastAttemptAt: 1_000 };
    expect(isDue(entry, 1_000 + 4_999)).toBe(false);
    expect(isDue(entry, 1_000 + 5_000)).toBe(true);
  });

  it("sends anything held over from an earlier session", () => {
    // A queue read at start-up carries timestamps from hours ago, and every
    // one of them is due. This is the ordinary case, not an edge one: it is
    // what happens when the app is opened the morning after.
    expect(isDue({ attempts: 9, lastAttemptAt: 0 }, 8 * 3_600_000)).toBe(true);
  });
});
