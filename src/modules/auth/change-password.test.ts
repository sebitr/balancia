import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/client";
import { changePassword } from "./service";

const mocks = vi.hoisted(() => ({
  revokeOtherSessionsForUser: vi.fn(async () => 2),
  disconnectAll: vi.fn(async () => 1),
  verifyPassword: vi.fn(async () => true),
}));

vi.mock("./sessions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sessions")>()),
  revokeOtherSessionsForUser: mocks.revokeOtherSessionsForUser,
}));

vi.mock("./passwords", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./passwords")>()),
  verifyPassword: mocks.verifyPassword,
  hashPassword: vi.fn(async () => "hashed"),
}));

vi.mock("@/modules/agent-access/grants", () => ({
  disconnectAll: mocks.disconnectAll,
}));

/**
 * What changing a password ends. It is the one gesture in the app that
 * evicts anybody, so it evicts everything a borrowed session could have left
 * signed in: the other sessions and every connected assistant.
 */

/** A database that answers the one read and records the one write. */
function fakeDb(): Database {
  const row = {
    passwordHash: "stored",
    email: "ada@example.com",
    name: "Ada",
  };
  const select = {
    from: () => select,
    where: () => select,
    limit: async () => [row],
  };
  const update = { set: () => update, where: async () => undefined };
  return {
    select: () => select,
    update: () => update,
  } as unknown as Database;
}

describe("changing a password", () => {
  beforeEach(() => {
    mocks.revokeOtherSessionsForUser.mockClear();
    mocks.disconnectAll.mockClear();
    mocks.verifyPassword.mockResolvedValue(true);
  });

  it("ends the other sessions and every assistant connection", async () => {
    const db = fakeDb();
    await changePassword("user-1", "the-old-password-1", "a-new-password-1", {
      db,
      currentSessionToken: "mine",
    });

    expect(mocks.revokeOtherSessionsForUser).toHaveBeenCalledWith(
      "user-1",
      "mine",
      { db },
    );
    expect(mocks.disconnectAll).toHaveBeenCalledWith("user-1", { db });
  });

  it("ends nothing when the current password is wrong", async () => {
    mocks.verifyPassword.mockResolvedValue(false);
    await expect(
      changePassword("user-1", "a-guess", "a-new-password-1", {
        db: fakeDb(),
      }),
    ).rejects.toThrow(/current password/);

    expect(mocks.revokeOtherSessionsForUser).not.toHaveBeenCalled();
    expect(mocks.disconnectAll).not.toHaveBeenCalled();
  });
});
