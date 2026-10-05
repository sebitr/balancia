import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  type AuthorizationCode,
} from "@/lib/security/authorization";
import { mobileApiError } from "./mobile";

/**
 * What the mobile API answers when somebody is refused.
 *
 * Every `AuthorizationError` used to be 404 `"Not found."`, which is right for
 * somebody outside the group and wrong for everybody in it: the owner trying to
 * remove themselves was told their own group did not exist, and so was an
 * entry naming somebody removed a minute before — which the web's offline
 * queue, like any client would, read as the group being gone.
 */

async function answer(error: unknown) {
  const response = mobileApiError(error, "test");
  return { status: response.status, body: await response.json() };
}

/** The two refusals that exist to say nothing, and must go on saying it. */
const HIDDEN: ReadonlySet<AuthorizationCode> = new Set([
  "noGroupAccess",
  "notInGroup",
]);

describe("a refusal to somebody outside the group", () => {
  it("is a 404 that does not say why", async () => {
    expect(await answer(new AuthorizationError())).toEqual({
      status: 404,
      body: { error: "Not found." },
    });
  });

  it("is the same 404 for an item that is not in the group", async () => {
    // An expense id from another group has to read exactly like one that was
    // never minted, or ids could be probed one group at a time.
    const { status, body } = await answer(
      new AuthorizationError(
        "That expense is not part of this group.",
        "notInGroup",
      ),
    );

    expect(status).toBe(404);
    expect(body).toEqual({ error: "Not found." });
  });
});

describe("a refusal to somebody in the group", () => {
  it.each([
    ["participantNotInGroup", 422],
    ["importParticipantUnknown", 422],
    ["ownerNotRemovable", 409],
    ["participantHasAccount", 409],
    ["groupArchived", 409],
    ["noPermission", 403],
    ["notYourAccount", 403],
    ["adminRequired", 403],
  ] as const)("answers %s with %i and its code", async (code, status) => {
    const sentence = `An English sentence for ${code}.`;

    expect(await answer(new AuthorizationError(sentence, code))).toEqual({
      status,
      body: { error: sentence, code },
    });
  });

  it("keeps it out of any shared cache", () => {
    const response = mobileApiError(
      new AuthorizationError("No.", "groupArchived"),
      "test",
    );

    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

/**
 * Every code a service throws has been decided.
 *
 * A code that nobody placed in `IN_GROUP_STATUS` falls to the anonymous 404,
 * which is the safe way to be wrong and still the way this bug began: six
 * refusals given inside a group answered as if the group did not exist,
 * because that was what a refusal answered unless somebody said otherwise.
 * So the source is read for every code passed to the constructor, and each
 * must either be one of the two that hide on purpose or answer something else.
 */
describe("every refusal the services can throw", () => {
  const root = process.cwd();

  function sourceFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)
        ? [path]
        : [];
    });
  }

  const thrown = new Map<string, string>();
  const unreadable: string[] = [];
  for (const file of sourceFiles(join(root, "src"))) {
    const source = readFileSync(file, "utf8");
    for (const call of source.matchAll(/new AuthorizationError\(/g)) {
      const rest = source.slice(call.index + call[0].length);
      if (/^\s*\)/.test(rest)) continue;
      // A sentence and a literal code, which is the only other shape the
      // constructor's overloads accept.
      const coded = /^\s*(?:"(?:[^"\\]|\\.)*"|`[^`]*`)\s*,\s*"(\w+)"/.exec(
        rest,
      );
      if (coded) thrown.set(coded[1]!, relative(root, file));
      else unreadable.push(relative(root, file));
    }
  }

  it("names its code as a literal this test can read", () => {
    expect(unreadable).toEqual([]);
    // The scan finding nothing would pass every check below for nothing.
    expect(thrown.size).toBeGreaterThan(5);
  });

  it("either hides on purpose or says what it is", async () => {
    const undecided: string[] = [];
    for (const [code, file] of thrown) {
      const { status, body } = await answer(
        new AuthorizationError("A sentence.", code as AuthorizationCode),
      );
      const hidden = HIDDEN.has(code as AuthorizationCode);
      if (hidden ? status !== 404 || "code" in body : status === 404) {
        undecided.push(`${code} (${file})`);
      }
    }

    expect(undecided).toEqual([]);
  });
});
