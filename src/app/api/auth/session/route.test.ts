// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sign-out's answer, and the one header on it.
 *
 * The web calls this before its Server Action precisely because an action
 * cannot set a response header, so the header is the thing worth pinning —
 * and that it is `"cache"` alone. `"storage"` would unregister the service
 * worker, taking this browser's push subscription and the offline screen with
 * it for whoever uses the device next.
 */

const { readSessionCookie, clearSessionCookie, revokeSession } = vi.hoisted(
  () => ({
    readSessionCookie: vi.fn<() => Promise<string | null>>(),
    clearSessionCookie: vi.fn<() => Promise<void>>(),
    revokeSession: vi.fn<(token: string) => Promise<void>>(),
  }),
);

vi.mock("@/modules/auth/cookies", () => ({
  readSessionCookie: () => readSessionCookie(),
  clearSessionCookie: () => clearSessionCookie(),
  setSessionCookie: vi.fn(),
}));
vi.mock("@/modules/auth/sessions", () => ({
  revokeSession: (token: string) => revokeSession(token),
}));

const { DELETE } = await import("./route");

beforeEach(() => {
  readSessionCookie.mockReset();
  clearSessionCookie.mockReset().mockResolvedValue(undefined);
  revokeSession.mockReset().mockResolvedValue(undefined);
});

describe("DELETE /api/auth/session", () => {
  it("revokes the session and asks the browser to drop its cache", async () => {
    readSessionCookie.mockResolvedValue("token");

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(revokeSession).toHaveBeenCalledWith("token");
    expect(clearSessionCookie).toHaveBeenCalledOnce();
    expect(response.headers.get("Clear-Site-Data")).toBe('"cache"');
  });

  it("answers the same with no session, as after an account is deleted", async () => {
    readSessionCookie.mockResolvedValue(null);

    const response = await DELETE();

    expect(response.status).toBe(200);
    expect(revokeSession).not.toHaveBeenCalled();
    expect(response.headers.get("Clear-Site-Data")).toBe('"cache"');
  });
});
