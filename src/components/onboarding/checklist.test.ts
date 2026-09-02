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
  hasPasskey: true,
  passkeyAdded: false,
  passkeysSupported: true,
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

  it("keeps to five rows for an account that came in with a passkey", () => {
    expect(checklistRows(base)).toHaveLength(5);
  });

  it("leaves a guest four rows: no account to hang a photo on", () => {
    const rows = checklistRows({ ...base, isGuest: true });
    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.id)).not.toContain("profile");
    expect(rows.map((row) => row.id)).not.toContain("passkey");
  });

  it("opens the name-and-photo sheet until there is a photo", () => {
    // This was the one row nobody could tap: a photo could only be added
    // from the profile page, which the list never mentioned.
    expect(row(base, "profile").sheet).toBe("profile");
    expect(row({ ...base, hasPhoto: true }, "profile").sheet).toBeNull();
  });

  it("offers a passkey to an account that came in with a code", () => {
    const rows = checklistRows({
      ...base,
      credential: "code",
      hasPasskey: false,
    });
    expect(rows).toHaveLength(6);
    const passkey = rows.find((candidate) => candidate.id === "passkey");
    expect(passkey).toMatchObject({
      marker: "todo",
      noteKey: "passkeyNote",
      sheet: "passkey",
    });
    // Right after the account row: it is the next thing worth doing.
    expect(rows[1]?.id).toBe("passkey");
  });

  it("never offers a passkey the account already has, or cannot hold", () => {
    // Already has one, somewhere: the list is for what is left.
    expect(
      checklistRows({ ...base, credential: "code", hasPasskey: true }).map(
        (candidate) => candidate.id,
      ),
    ).not.toContain("passkey");
    // Unless it was this list that added it, in which case the row stays as
    // the receipt.
    expect(
      checklistRows({
        ...base,
        credential: "code",
        hasPasskey: true,
        passkeyAdded: true,
      }).find((candidate) => candidate.id === "passkey"),
    ).toMatchObject({
      marker: "done",
      noteKey: "passkeyNoteDone",
      sheet: null,
    });
    expect(
      checklistRows({
        ...base,
        credential: "code",
        hasPasskey: false,
        passkeysSupported: false,
      }).map((candidate) => candidate.id),
    ).not.toContain("passkey");
    // The account row already says "passkey saved to this phone".
    expect(
      checklistRows({ ...base, credential: "passkey" }).map(
        (candidate) => candidate.id,
      ),
    ).not.toContain("passkey");
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
    expect(
      checklistIsComplete({
        ...everything,
        credential: "code",
        hasPasskey: false,
      }),
    ).toBe(false);
  });

  it("does not hold a passkey against a browser that cannot make one", () => {
    expect(
      checklistIsComplete({
        ...everything,
        credential: "code",
        hasPasskey: false,
        passkeysSupported: false,
      }),
    ).toBe(true);
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
    expect(checklistProgress(guest)).toEqual({ done: 0, total: 4 });
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
