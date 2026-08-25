import { describe, expect, it } from "vitest";
import {
  checklistIsComplete,
  checklistProgress,
  checklistRows,
  type ChecklistState,
} from "./checklist";

const base: ChecklistState = {
  isGuest: false,
  credential: "passkey",
  email: "seb@hey.ch",
  hasPhoto: false,
  name: "Seb",
  currencies: [],
  payouts: [],
  notificationsOn: 4,
  notificationCount: 5,
  pushEnabled: false,
};

const row = (state: ChecklistState, id: string) => {
  const found = checklistRows(state).find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no ${id} row`);
  return found;
};

describe("checklistRows", () => {
  it("says which way in was actually taken", () => {
    expect(row(base, "account").noteKey).toBe("accountNotePasskey");
    expect(row({ ...base, credential: "code" }, "account").noteKey).toBe(
      "accountNoteVerified",
    );
  });

  it("marks a guest's account urgent, and never merely done-and-important", () => {
    const account = row({ ...base, isGuest: true }, "account");
    expect(account.marker).toBe("urgent");
    // A filled coral check would be indistinguishable from `done` in
    // greyscale, so `urgent` must stay its own marker rather than a tint.
    expect(account.marker).not.toBe("done");
    expect(account.sheet).toBe("claimAccount");
  });

  it("opens nothing from a completed row", () => {
    expect(row(base, "account").sheet).toBeNull();
  });

  it("completes the currency row only once currencies have been picked", () => {
    expect(row(base, "currencies").marker).toBe("todo");
    const picked = row({ ...base, currencies: ["CHF", "EUR"] }, "currencies");
    expect(picked.marker).toBe("done");
    expect(picked.noteValues).toEqual({ codes: "CHF · EUR" });
  });

  it("completes notifications on the device subscription, not on the switches", () => {
    // Every switch defaults to on, so counting them would tick the row before
    // anybody had been asked anything.
    expect(row(base, "notifications").marker).toBe("todo");
    expect(row({ ...base, pushEnabled: true }, "notifications").marker).toBe(
      "done",
    );
  });

  it("distinguishes pushed-to-this-device from in-the-app-only", () => {
    expect(row(base, "notifications").noteKey).toBe("notificationsNoteInApp");
    expect(row({ ...base, pushEnabled: true }, "notifications").noteKey).toBe(
      "notificationsNotePushed",
    );
  });

  it("keeps five rows whether or not this is a guest", () => {
    expect(checklistRows(base)).toHaveLength(5);
    expect(checklistRows({ ...base, isGuest: true })).toHaveLength(5);
  });
});

describe("checklistIsComplete", () => {
  const everything: ChecklistState = {
    ...base,
    hasPhoto: true,
    currencies: ["CHF"],
    payouts: ["TWINT"],
    pushEnabled: true,
  };

  it("is true only once every row is done", () => {
    expect(checklistIsComplete(everything)).toBe(true);
    expect(checklistIsComplete(base)).toBe(false);
  });

  it("is false while any single row is outstanding", () => {
    // One at a time, because a screen that hides itself on four out of five
    // is worse than one that shows five green ticks.
    expect(checklistIsComplete({ ...everything, hasPhoto: false })).toBe(false);
    expect(checklistIsComplete({ ...everything, currencies: [] })).toBe(false);
    expect(checklistIsComplete({ ...everything, payouts: [] })).toBe(false);
    expect(checklistIsComplete({ ...everything, pushEnabled: false })).toBe(
      false,
    );
  });

  it("is never true for a guest, whose account row is urgent", () => {
    // Urgent is not done. A guest with all four of the others still has the
    // one thing on this list that closing the browser loses.
    expect(checklistIsComplete({ ...everything, isGuest: true })).toBe(false);
  });
});

describe("checklistProgress", () => {
  it("counts only what is done, so an urgent row is not credit", () => {
    const guest = checklistRows({ ...base, isGuest: true });
    expect(checklistProgress(guest)).toEqual({ done: 0, total: 5 });
  });

  it("counts up as rows are finished", () => {
    const finished = checklistRows({
      ...base,
      hasPhoto: true,
      currencies: ["CHF"],
      payouts: ["TWINT"],
      pushEnabled: true,
    });
    expect(checklistProgress(finished)).toEqual({ done: 5, total: 5 });
  });
});
