import { beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../../messages/en.json";

/**
 * Choosing an accent stores its name, the default included.
 *
 * It used to store a choice of the default — coral, then — as null, which is
 * why an account from that time cannot say whether it picked coral or never
 * looked. Writing the name keeps every choice made since then a choice, so the
 * next change of default can leave it alone.
 */

const mocks = vi.hoisted(() => ({
  user: null as null | { kind: "user"; userId: string },
  saveUserAccentColor: vi.fn(),
  writeAccentCookie: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const entries = messages[namespace] as Record<string, string>;
    const translate = (key: string) => entries[key] ?? key;
    return Object.assign(translate, { has: (key: string) => key in entries });
  },
}));
vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => mocks.user,
}));
vi.mock("@/modules/auth/service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  saveUserAccentColor: mocks.saveUserAccentColor,
}));
vi.mock("@/i18n/cookie", () => ({
  writeAccentCookie: mocks.writeAccentCookie,
  writeFormatCookies: vi.fn(),
  writeSurfaceCookies: vi.fn(),
}));

const { setAccentColorAction } = await import("./actions");

beforeEach(() => {
  mocks.user = { kind: "user", userId: "user-1" };
  mocks.saveUserAccentColor.mockReset();
  mocks.writeAccentCookie.mockReset();
});

describe("setAccentColorAction", () => {
  it.each(["coral", "plum", "mint"])(
    "stores %s by name, on the account and in the cookie",
    async (accent) => {
      expect(await setAccentColorAction(accent)).toMatchObject({ ok: true });
      expect(mocks.writeAccentCookie).toHaveBeenCalledWith(accent);
      expect(mocks.saveUserAccentColor).toHaveBeenCalledWith("user-1", accent);
    },
  );

  it("writes only the cookie for a signed-out reader", async () => {
    mocks.user = null;
    expect(await setAccentColorAction("coral")).toMatchObject({ ok: true });
    expect(mocks.writeAccentCookie).toHaveBeenCalledWith("coral");
    expect(mocks.saveUserAccentColor).not.toHaveBeenCalled();
  });

  it("refuses a name it cannot paint, and writes nothing", async () => {
    expect(await setAccentColorAction("chartreuse")).toMatchObject({
      ok: false,
    });
    expect(mocks.writeAccentCookie).not.toHaveBeenCalled();
    expect(mocks.saveUserAccentColor).not.toHaveBeenCalled();
  });
});
