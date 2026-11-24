import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import type { RcloneRemote } from "./rclone-config";
import {
  instanceApp,
  openTransport,
  providerAvailability,
  TOKEN_MARGIN_MS,
} from "./transport";

/** The remotes rclone was handed, in order, without running it. */
const listed = vi.hoisted(() => [] as RcloneRemote[]);
vi.mock("./rclone", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./rclone")>()),
  listObjects: vi.fn(async (remote: RcloneRemote) => {
    listed.push(remote);
    return [];
  }),
}));

/**
 * Which app an account provider acts as, decided where the token is minted.
 *
 * No rclone runs here: opening a transport refreshes the token and builds the
 * remote's settings, and only using it starts a process. So the token endpoint
 * is stood in for, and what these tests look at is who it was asked as.
 */

const OWN = { clientId: "mine.apps.example", clientSecret: "my-secret-9" };

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  process.env.DATABASE_URL = "postgres://balancia:pw@localhost:5432/balancia";
  process.env.APP_URL = "https://balancia.example.com";
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ["GOOGLE", "DROPBOX", "MICROSOFT"]) {
    delete process.env[`BACKUP_${name}_CLIENT_ID`];
    delete process.env[`BACKUP_${name}_CLIENT_SECRET`];
  }
  delete process.env.BACKUP_EXPERIMENTAL_PROVIDERS;
  resetEnvCache();
});

function tokenEndpoint(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function askedAs(fetchMock: ReturnType<typeof tokenEndpoint>): URLSearchParams {
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  return new URLSearchParams(init.body as URLSearchParams);
}

describe("an account connection's app", () => {
  it("is the person's own when the connection was made through one", async () => {
    const fetchMock = tokenEndpoint({ access_token: "at", expires_in: 3600 });

    await openTransport("google_drive", { refreshToken: "rt", app: OWN });

    const body = askedAs(fetchMock);
    expect(body.get("client_id")).toBe("mine.apps.example");
    expect(body.get("client_secret")).toBe("my-secret-9");
  });

  it("is the server's for a connection that has none of its own", async () => {
    process.env.BACKUP_DROPBOX_CLIENT_ID = "server-id";
    process.env.BACKUP_DROPBOX_CLIENT_SECRET = "server-secret";
    resetEnvCache();
    const fetchMock = tokenEndpoint({ access_token: "at", expires_in: 3600 });

    await openTransport("dropbox", { refreshToken: "rt" });

    expect(askedAs(fetchMock).get("client_id")).toBe("server-id");
  });

  it("stays the person's own when the server has one too", async () => {
    process.env.BACKUP_GOOGLE_CLIENT_ID = "server-id";
    process.env.BACKUP_GOOGLE_CLIENT_SECRET = "server-secret";
    resetEnvCache();
    const fetchMock = tokenEndpoint({ access_token: "at", expires_in: 3600 });

    await openTransport("google_drive", { refreshToken: "rt", app: OWN });

    expect(askedAs(fetchMock).get("client_id")).toBe("mine.apps.example");
  });

  it("is refused before anyone is asked when there is none at all", async () => {
    const fetchMock = tokenEndpoint({ access_token: "at" });

    await expect(
      openTransport("onedrive", {
        refreshToken: "rt",
        driveId: "d",
        driveType: "personal",
        rootFolderId: "f",
      }),
    ).rejects.toMatchObject({ code: "app" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads a rejected app as the app's fault, so the run stops being retried until the person acts", async () => {
    tokenEndpoint({ error: "invalid_client" }, 401);

    await expect(
      openTransport("google_drive", { refreshToken: "rt", app: OWN }),
    ).rejects.toMatchObject({ code: "app" });
  });

  it("does not take a revoked token for a rejected app", async () => {
    tokenEndpoint({ error: "invalid_grant" }, 400);

    await expect(
      openTransport("google_drive", { refreshToken: "rt", app: OWN }),
    ).rejects.toMatchObject({ code: "reconnect" });
  });

  it("hands back a rotated refresh token to be kept, with the app staying where it is", async () => {
    tokenEndpoint({
      access_token: "at",
      refresh_token: "rt-rotated",
      expires_in: 3600,
    });
    const kept = vi.fn(async () => undefined);

    await openTransport(
      "google_drive",
      { refreshToken: "rt", app: OWN },
      { onRefreshToken: kept },
    );

    expect(kept).toHaveBeenCalledWith("rt-rotated");
  });

  describe("over a run longer than an access token lasts", () => {
    const TOKEN_ENV = "RCLONE_CONFIG_BACKUP_TOKEN";
    const tokenIn = (remote: RcloneRemote | undefined) =>
      JSON.parse(remote?.env[TOKEN_ENV] ?? "{}") as {
        access_token?: string;
        refresh_token?: string;
      };

    /** A token endpoint that rotates the refresh token on every call. */
    function rotatingEndpoint() {
      let issued = 0;
      const fetchMock = vi.fn(async () => {
        issued += 1;
        return new Response(
          JSON.stringify({
            access_token: `at-${issued}`,
            refresh_token: `rt-${issued}`,
            expires_in: 3600,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    beforeEach(() => {
      listed.length = 0;
    });

    it("refreshes before a call the token might not outlast, and keeps what the provider rotated", async () => {
      const fetchMock = rotatingEndpoint();
      const kept = vi.fn(async () => undefined);
      let clock = new Date("2026-10-09T03:00:00Z");

      const transport = await openTransport(
        "google_drive",
        { refreshToken: "rt-0", app: OWN },
        { onRefreshToken: kept, now: () => clock },
      );
      // Fifty minutes in: ten left on an hour's token, less than one call may take.
      clock = new Date(
        clock.getTime() + 3600_000 - TOKEN_MARGIN_MS + 5 * 60_000,
      );
      await transport.list();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // The second refresh presents the token the first one rotated to, not
      // the spent one the transport was opened with.
      expect(
        new URLSearchParams(
          (fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1]
            .body as URLSearchParams,
        ).get("refresh_token"),
      ).toBe("rt-1");
      expect(kept.mock.calls).toEqual([["rt-1"], ["rt-2"]]);
      // And rclone is handed the fresh pair, so it has no reason to refresh
      // on its own and lose what it got.
      expect(tokenIn(listed[0])).toMatchObject({
        access_token: "at-2",
        refresh_token: "rt-2",
      });
    });

    it("leaves a token with time to spare alone", async () => {
      const fetchMock = rotatingEndpoint();
      const clock = new Date("2026-10-09T03:00:00Z");

      const transport = await openTransport(
        "google_drive",
        { refreshToken: "rt-0", app: OWN },
        { now: () => clock },
      );
      await transport.list();
      await transport.list();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(tokenIn(listed[1])).toMatchObject({ access_token: "at-1" });
    });

    it("refreshes once when several calls find the token low together", async () => {
      const fetchMock = rotatingEndpoint();
      let clock = new Date("2026-10-09T03:00:00Z");
      const transport = await openTransport(
        "google_drive",
        { refreshToken: "rt-0", app: OWN },
        { now: () => clock },
      );
      clock = new Date(clock.getTime() + 3600_000);

      await Promise.all([transport.list(), transport.list()]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("refuses a pasted app with a space or a line break in it", async () => {
    const fetchMock = tokenEndpoint({ access_token: "at" });

    await expect(
      openTransport("google_drive", {
        refreshToken: "rt",
        app: { clientId: "mine", clientSecret: "two words" },
      }),
    ).rejects.toMatchObject({ code: "reconnect" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("what a server offers", () => {
  it("offers the three account providers whether or not the operator registered an app", () => {
    for (const provider of ["google_drive", "dropbox", "onedrive"] as const) {
      expect(providerAvailability(provider)).toBe("available");
      expect(instanceApp(provider)).toBe(false);
    }
  });

  it("says which of them has one button, and only that one", () => {
    process.env.BACKUP_MICROSOFT_CLIENT_ID = "ms-id";
    process.env.BACKUP_MICROSOFT_CLIENT_SECRET = "ms-secret";
    resetEnvCache();

    expect(instanceApp("onedrive")).toBe(true);
    expect(instanceApp("google_drive")).toBe(false);
    expect(instanceApp("s3")).toBe(false);
  });

  it("still keeps Proton Drive switched off until the operator turns it on", () => {
    expect(providerAvailability("proton_drive")).toBe("experimental_off");
  });
});
