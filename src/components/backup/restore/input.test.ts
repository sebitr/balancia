import { describe, expect, it } from "vitest";
import { createRecoveryKey } from "@/modules/backup/age";
import { extractKey } from "./input";

/**
 * Finding the recovery key in whatever the person hands over.
 *
 * The keys here are real ones, made by the code that makes them, so the
 * pattern is held to what `createRecoveryKey` actually writes and not to a
 * string somebody typed into a test.
 */

describe("extractKey", () => {
  it("reads the key out of a file in the layout age-keygen writes", async () => {
    const { identity, recipient } = await createRecoveryKey();
    const file = [
      "# created: 2026-10-09T03:30:12Z",
      `# public key: ${recipient}`,
      identity,
      "",
    ].join("\n");

    expect(extractKey(file)).toBe(identity);
  });

  it("finds the key in a whole file pasted into a one-line field", async () => {
    // A text box drops the newlines and leaves the comments glued to the key.
    const { identity, recipient } = await createRecoveryKey();

    expect(
      extractKey(
        `# created: 2026-10-09 # public key: ${recipient} ${identity}`,
      ),
    ).toBe(identity);
  });

  it("trims what surrounds a key that is all there is", async () => {
    const { identity } = await createRecoveryKey();

    expect(extractKey(`  \n${identity}\r\n\t`)).toBe(identity);
  });

  it("puts a key typed in lower case into the case age expects", async () => {
    const { identity } = await createRecoveryKey();

    expect(extractKey(identity.toLowerCase())).toBe(identity);
  });

  it("reads the post-quantum kind that age-keygen -pq writes", () => {
    expect(extractKey("AGE-SECRET-KEY-PQ-1QQQQQQQQQQQQQQ")).toBe(
      "AGE-SECRET-KEY-PQ-1QQQQQQQQQQQQQQ",
    );
  });

  it("finds nothing in text that has no key in it", async () => {
    const { recipient } = await createRecoveryKey();

    expect(extractKey("")).toBeNull();
    expect(extractKey("my password manager has it")).toBeNull();
    // The public half is not the key, however much it looks like one.
    expect(extractKey(`# public key: ${recipient}`)).toBeNull();
  });
});
