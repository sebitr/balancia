import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Which accent a page is painted with, before anybody has read a row.
 *
 * Plum is the default now, and coral was before it. Accounts from that time
 * stored "never chose" and "chose coral" as the same null and hold no accent
 * cookie, so a cookie-only answer would have repainted every one of them. The
 * cases below are who gets which, and when the database is asked at all.
 */

const { jar, getCurrentUser, getUserPreferences } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  getCurrentUser: vi.fn(),
  getUserPreferences: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
    has: (name: string) => jar.has(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("./request", () => ({ resolveRequestLocale: async () => "en" }));
vi.mock("next-intl/server", () => ({ getTimeZone: async () => "UTC" }));
vi.mock("@/lib/security/actor", () => ({ getCurrentUser }));
vi.mock("@/modules/auth/service", () => ({ getUserPreferences }));

const { resolveAccentColor } = await import("./preferences");

const SESSION = "balancia_session";
const ACCENT = "balancia_accent";

function signedInAs(accentColor: string | null) {
  jar.set(SESSION, "token");
  getCurrentUser.mockResolvedValue({
    kind: "user",
    userId: "user-1",
    email: "ada@example.com",
    name: "Ada",
  });
  getUserPreferences.mockResolvedValue({
    locale: null,
    dateFormat: null,
    numberFormat: null,
    accentColor,
  });
}

beforeEach(() => {
  jar.clear();
  getCurrentUser.mockReset();
  getUserPreferences.mockReset();
});

describe("resolveAccentColor", () => {
  it("paints a signed-out reader plum, without asking the database", async () => {
    expect(await resolveAccentColor()).toBe("plum");
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(getUserPreferences).not.toHaveBeenCalled();
  });

  it("keeps a signed-out reader's own choice, coral included", async () => {
    jar.set(ACCENT, "coral");
    expect(await resolveAccentColor()).toBe("coral");
  });

  it("answers from the cookie when there is one, signed in or not", async () => {
    signedInAs(null);
    jar.set(ACCENT, "mint");
    expect(await resolveAccentColor()).toBe("mint");
    expect(getUserPreferences).not.toHaveBeenCalled();
  });

  it("keeps coral for an account from before plum, which stored null", async () => {
    // Never chose, or chose coral when coral was the default: the same row.
    signedInAs(null);
    expect(await resolveAccentColor()).toBe("coral");
    expect(getUserPreferences).toHaveBeenCalledWith("user-1");
  });

  it("paints a new account plum, from the name it was written with", async () => {
    signedInAs("plum");
    expect(await resolveAccentColor()).toBe("plum");
  });

  it("keeps coral for an account that chose it by name", async () => {
    signedInAs("coral");
    expect(await resolveAccentColor()).toBe("coral");
  });

  it("treats a cookie it cannot paint as no cookie at all", async () => {
    signedInAs(null);
    jar.set(ACCENT, "url(javascript:alert(1))");
    expect(await resolveAccentColor()).toBe("coral");
  });

  it("falls back to plum when the session cookie is stale", async () => {
    jar.set(SESSION, "expired");
    getCurrentUser.mockResolvedValue(null);
    expect(await resolveAccentColor()).toBe("plum");
    expect(getUserPreferences).not.toHaveBeenCalled();
  });
});
