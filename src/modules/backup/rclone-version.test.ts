import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The rclone the image ships, as both Dockerfiles pin it.
 *
 * From 1.76.0 rclone refuses a redirect from `https://` to `http://`
 * (GHSA-m97j-7x65-wh93). Before it, a public HTTPS backup endpoint could answer
 * "moved" and send the worker, blind and without credentials, to a metadata
 * service that only speaks plain HTTP — past the endpoint guard, which judges
 * the address once. See `docs/cloud-backup.md`, "Redirects".
 */

const FLOOR = [1, 76, 0] as const;

function pinned(file: string): string {
  const source = readFileSync(path.join(process.cwd(), file), "utf8");
  const match = /^ARG RCLONE_VERSION=(\S+)$/m.exec(source);
  expect(match, `${file} should pin RCLONE_VERSION`).not.toBeNull();
  return match![1]!;
}

function atLeast(version: string, floor: readonly number[]): boolean {
  const parts = version.split(".").map((part) => Number.parseInt(part, 10));
  for (let i = 0; i < floor.length; i += 1) {
    const have = parts[i] ?? 0;
    if (Number.isNaN(have)) return false;
    if (have !== floor[i]) return have > floor[i]!;
  }
  return true;
}

describe("the rclone the image ships", () => {
  it("is the same in the production and the development image", () => {
    expect(pinned("Dockerfile.dev")).toBe(pinned("Dockerfile"));
  });

  it("refuses an https-to-http redirect (1.76.0 or later)", () => {
    const version = pinned("Dockerfile");
    expect(
      atLeast(version, FLOOR),
      `RCLONE_VERSION ${version} follows an https→http redirect; keep it at ${FLOOR.join(".")} or later`,
    ).toBe(true);
  });

  it("compares versions numerically, not as text", () => {
    expect(atLeast("1.76.0", FLOOR)).toBe(true);
    expect(atLeast("1.76.1", FLOOR)).toBe(true);
    expect(atLeast("1.100.0", FLOOR)).toBe(true);
    expect(atLeast("2.0.0", FLOOR)).toBe(true);
    expect(atLeast("1.75.2", FLOOR)).toBe(false);
    expect(atLeast("1.9.0", FLOOR)).toBe(false);
    expect(atLeast("latest", FLOOR)).toBe(false);
  });
});
