import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/db/client", () => ({ getDb: () => null }));

const { huesFor } = await import("./face-hues");
const { avatarHue } = await import("@/components/ui/avatar-hue");

describe("huesFor", () => {
  it("colours a person by their account, whichever group they are in", () => {
    const account = "0f9b2c1e-3a77-4d5e-9b1a-6c2d8e4f1a20";
    const inFlat = huesFor([{ id: "participant-in-flat", userId: account }]);
    const inTrip = huesFor([{ id: "participant-in-trip", userId: account }]);

    expect(inFlat["participant-in-flat"]).toBe(avatarHue(account));
    expect(inTrip["participant-in-trip"]).toBe(inFlat["participant-in-flat"]);
  });

  it("colours somebody with no account by their participant", () => {
    const hues = huesFor([{ id: "guest-participant", userId: null }]);
    expect(hues["guest-participant"]).toBe(avatarHue("guest-participant"));
  });

  it("hands out hues by participant id and nothing else", () => {
    const hues = huesFor([
      { id: "p1", userId: "secret-account-id" },
      { id: "p2", userId: null },
    ]);
    expect(Object.keys(hues)).toEqual(["p1", "p2"]);
    expect(JSON.stringify(hues)).not.toContain("secret-account-id");
  });
});
