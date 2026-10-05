import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";

/**
 * A Server Action is an endpoint, and its TypeScript signature binds nobody
 * but the form that imports it. These are the actions whose arguments used to
 * be trusted from that signature: each one is called here with what a caller
 * could actually send, and must answer `malformedRequest` without the service
 * behind it ever being reached.
 *
 * Every service is a mock, so "never reached" is something this file can see.
 * Each group also sends one well-formed call, which is what proves the mock is
 * the one the action calls — without it, a refusal and a broken wiring would
 * pass alike.
 */

const USER = {
  kind: "user" as const,
  userId: randomUUID(),
  email: "ada@example.test",
  name: "Ada",
};
const GROUP_ID = randomUUID();

const mocks = vi.hoisted(() => ({
  authorizeGroup: vi.fn(),
  createApiToken: vi.fn(),
  receiptScanUsed: vi.fn(),
  markRead: vi.fn(),
  savePreferences: vi.fn(),
  setGroupMuted: vi.fn(),
  setGroupArchived: vi.fn(),
  setRecurringPaused: vi.fn(),
  createExpense: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Resolved against the shipped English catalogue, as in `actions.test.ts`, so
// the refusal checked below is the sentence a person would actually read.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const entries = messages[namespace] as Record<string, string>;
    const translate = (key: string) => entries[key] ?? key;
    return Object.assign(translate, { has: (key: string) => key in entries });
  },
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => USER,
  getCurrentActor: async () => USER,
  getClientIp: async () => "127.0.0.1",
}));
vi.mock("@/lib/security/authorization", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  authorizeGroup: mocks.authorizeGroup,
}));
vi.mock("@/modules/api-tokens/service", () => ({
  createApiToken: mocks.createApiToken,
  revokeApiToken: vi.fn(),
}));
vi.mock("@/modules/api-tokens/serialize", () => ({
  serializeApiToken: (record: unknown) => record,
}));
vi.mock("@/lib/telemetry", () => ({
  telemetry: { receiptScanUsed: mocks.receiptScanUsed },
}));
vi.mock("@/modules/notifications/service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  markRead: mocks.markRead,
  savePreferences: mocks.savePreferences,
  setGroupMuted: mocks.setGroupMuted,
}));
vi.mock("@/modules/groups/service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setGroupArchived: mocks.setGroupArchived,
}));
vi.mock("@/modules/recurring/service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  setRecurringPaused: mocks.setRecurringPaused,
}));
vi.mock("@/modules/expenses/service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createExpense: mocks.createExpense,
}));

const { createApiTokenAction } = await import("@/modules/api-tokens/actions");
const { recordReceiptScanAction } = await import("@/modules/telemetry/actions");
const { markReadAction, savePreferencesAction, setGroupMutedAction } =
  await import("@/modules/notifications/actions");
const { setGroupArchivedAction } = await import("@/modules/groups/actions");
const { setRecurringPausedAction } =
  await import("@/modules/recurring/actions");
const { createExpenseAction } = await import("@/modules/expenses/actions");

const MALFORMED = {
  ok: false,
  error: messages.serverErrors.malformedRequest,
};

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.authorizeGroup.mockImplementation(async (_actor, groupId: string) => ({
    groupId,
  }));
  mocks.createApiToken.mockResolvedValue({ token: "blc_x", record: {} });
  mocks.createExpense.mockResolvedValue(randomUUID());
});

/** Casts a value a caller could send to whatever the signature claims. */
const sent = <T>(value: unknown) => value as T;

describe("createApiTokenAction", () => {
  it.each([
    ["a scope off the list", { name: "Cron", scope: "admin" }],
    [
      "a group id that is not a UUID",
      { name: "Cron", scope: "read", groupId: "1" },
    ],
    ["a name that is not a string", { name: 42, scope: "read" }],
  ])("refuses %s", async (_label, input) => {
    expect(await createApiTokenAction(sent(input))).toEqual(MALFORMED);
    expect(mocks.createApiToken).not.toHaveBeenCalled();
  });

  it("mints a key from a well-formed request", async () => {
    const result = await createApiTokenAction({
      name: "Cron",
      scope: "read",
      groupId: null,
    });
    expect(result.ok).toBe(true);
    expect(mocks.createApiToken).toHaveBeenCalledWith(USER.userId, {
      name: "Cron",
      scope: "read",
      groupId: null,
    });
  });
});

describe("recordReceiptScanAction", () => {
  it.each(["opened", "", 1, null])("refuses the outcome %j", async (word) => {
    expect(await recordReceiptScanAction(sent(word))).toEqual(MALFORMED);
    expect(mocks.receiptScanUsed).not.toHaveBeenCalled();
  });

  it("records a word from the list", async () => {
    expect((await recordReceiptScanAction("empty")).ok).toBe(true);
    expect(mocks.receiptScanUsed).toHaveBeenCalledWith({ outcome: "empty" });
  });
});

describe("markReadAction", () => {
  it.each([
    ["an id that is not a UUID", ["42"]],
    ["a string where a list belongs", GROUP_ID],
    [
      "more ids than the inbox holds",
      Array.from({ length: 101 }, () => randomUUID()),
    ],
  ])("refuses %s", async (_label, ids) => {
    expect(await markReadAction(sent(ids))).toEqual(MALFORMED);
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("marks the ids it was given, or everything", async () => {
    const id = randomUUID();
    expect((await markReadAction([id])).ok).toBe(true);
    expect(mocks.markRead).toHaveBeenLastCalledWith(USER.userId, [id]);
    expect((await markReadAction()).ok).toBe(true);
    expect(mocks.markRead).toHaveBeenLastCalledWith(USER.userId, undefined);
  });
});

describe("savePreferencesAction", () => {
  const preferences = {
    expenses: true,
    settlements: true,
    recurring: false,
    imports: true,
    reminders: false,
  };

  it.each([
    ["the word false", { ...preferences, recurring: "false" }],
    ["a missing switch", { ...preferences, reminders: undefined }],
    ["a number", { ...preferences, expenses: 0 }],
  ])("refuses %s", async (_label, input) => {
    expect(await savePreferencesAction(sent(input))).toEqual(MALFORMED);
    expect(mocks.savePreferences).not.toHaveBeenCalled();
  });

  it("saves five real switches", async () => {
    expect((await savePreferencesAction(preferences)).ok).toBe(true);
    expect(mocks.savePreferences).toHaveBeenCalledWith(
      USER.userId,
      preferences,
    );
  });
});

describe("setGroupMutedAction", () => {
  it.each([
    ["the word false", GROUP_ID, "false"],
    ["a group id that is not a UUID", "42", true],
  ])("refuses %s", async (_label, groupId, muted) => {
    expect(await setGroupMutedAction(groupId, sent(muted))).toEqual(MALFORMED);
    expect(mocks.authorizeGroup).not.toHaveBeenCalled();
    expect(mocks.setGroupMuted).not.toHaveBeenCalled();
  });

  it("unmutes when asked to", async () => {
    expect((await setGroupMutedAction(GROUP_ID, false)).ok).toBe(true);
    expect(mocks.setGroupMuted).toHaveBeenCalledWith(
      USER.userId,
      GROUP_ID,
      false,
    );
  });
});

describe("setGroupArchivedAction", () => {
  it.each([
    ["the word false", GROUP_ID, "false"],
    ["a group id that is not a UUID", "42", true],
  ])("refuses %s", async (_label, groupId, archived) => {
    expect(await setGroupArchivedAction(groupId, sent(archived))).toEqual(
      MALFORMED,
    );
    expect(mocks.authorizeGroup).not.toHaveBeenCalled();
    expect(mocks.setGroupArchived).not.toHaveBeenCalled();
  });

  it("brings a group back when asked to", async () => {
    expect((await setGroupArchivedAction(GROUP_ID, false)).ok).toBe(true);
    expect(mocks.setGroupArchived).toHaveBeenCalledWith(
      { groupId: GROUP_ID },
      false,
    );
  });
});

describe("setRecurringPausedAction", () => {
  const templateId = randomUUID();

  it.each([
    ["the word true", GROUP_ID, templateId, "true"],
    ["a template id that is not a UUID", GROUP_ID, "7", true],
    ["a group id that is not a UUID", "x", templateId, true],
  ])("refuses %s", async (_label, groupId, id, paused) => {
    expect(await setRecurringPausedAction(groupId, id, sent(paused))).toEqual(
      MALFORMED,
    );
    expect(mocks.authorizeGroup).not.toHaveBeenCalled();
    expect(mocks.setRecurringPaused).not.toHaveBeenCalled();
  });

  it("resumes a series when asked to", async () => {
    expect(
      (await setRecurringPausedAction(GROUP_ID, templateId, false)).ok,
    ).toBe(true);
    expect(mocks.setRecurringPaused).toHaveBeenCalledWith(
      { groupId: GROUP_ID },
      templateId,
      false,
    );
  });
});

describe("createExpenseAction", () => {
  const person = randomUUID();
  const expense = (expenseDate = "2026-09-01") => ({
    description: "Dinner",
    amount: "2500",
    currency: "EUR",
    expenseDate,
    payers: [{ participantId: person, amount: "2500" }],
    splitMethod: "equal",
    splitEntries: [{ participantId: person }],
  });

  it.each([
    ["a key that is not a UUID", "outbox-1"],
    ["a key that is not a string", 7],
    ["an empty key", ""],
  ])("refuses %s", async (_label, key) => {
    expect(await createExpenseAction(GROUP_ID, expense(), sent(key))).toEqual(
      MALFORMED,
    );
    expect(mocks.createExpense).not.toHaveBeenCalled();
  });

  it("refuses a day the calendar does not have", async () => {
    const result = await createExpenseAction(GROUP_ID, expense("2025-02-30"));
    expect(result).toEqual({ ok: false, error: "Not a real date" });
    expect(mocks.createExpense).not.toHaveBeenCalled();
  });

  it("writes an entry with a key, and without one", async () => {
    const key = randomUUID();
    expect((await createExpenseAction(GROUP_ID, expense(), key)).ok).toBe(true);
    expect(mocks.createExpense).toHaveBeenLastCalledWith(
      { groupId: GROUP_ID },
      expect.objectContaining({ expenseDate: "2026-09-01" }),
      { clientKey: key },
    );
    expect((await createExpenseAction(GROUP_ID, expense())).ok).toBe(true);
    expect(mocks.createExpense).toHaveBeenLastCalledWith(
      { groupId: GROUP_ID },
      expect.anything(),
      { clientKey: undefined },
    );
  });
});
